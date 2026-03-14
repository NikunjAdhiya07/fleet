import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import DeviceCallLog from "@/models/DeviceCallLog";
import CallLog from "@/models/CallLog";
import {
  answerCallbackQuery,
  editMessageText,
  sendInlineKeyboard,
  categoryKeyboard,
  saveContactKeyboard,
  sendMessage,
} from "@/lib/telegram";

function isValidRequest(req: Request): boolean {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return true; // If no secret configured, allow (for local dev)
  
  const providedSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (providedSecret !== expectedSecret) {
    console.warn(`[Webhook Auth] Token mismatch. Expected: '${expectedSecret}', got: '${providedSecret}'`);
    return false;
  }
  return true;
}

/** Resolve companyId for an employee from call logs (for legacy EmployeeTelegram records missing companyId). */
async function resolveCompanyIdForEmployee(
  _phoneNumber: string,
  employeeName: string
): Promise<mongoose.Types.ObjectId | null> {
  // DeviceCallLog: employeeName is who made/received the call; phoneNumber there is the contact's number
  const fromDevice = await DeviceCallLog.findOne({
    employeeName,
    companyId: { $exists: true, $ne: null },
  })
    .select("companyId")
    .lean();

  if (fromDevice?.companyId) return fromDevice.companyId as mongoose.Types.ObjectId;

  const fromCallLog = await CallLog.findOne({
    employeeName,
    companyId: { $exists: true, $ne: null },
  })
    .select("companyId")
    .lean();

  if (fromCallLog?.companyId) return fromCallLog.companyId as mongoose.Types.ObjectId;

  return null;
}

export async function POST(req: Request) {
  if (!isValidRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  try {
    await connectToDatabase();

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return NextResponse.json({ ok: true });
    }

    if (update.message) {
      await handleMessage(update.message);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook] Error:", err);
    return NextResponse.json({ ok: true });
  }
}

// ── Callback Query Handler ─────────────────────────────────────────────────

async function handleCallbackQuery(query: any) {
  const data: string = query.data ?? "";
  const chatId: number = query.message?.chat?.id;
  const messageId: number = query.message?.message_id;
  const callbackId: string = query.id;

  // Category selection: cat:<phone>:<employee>:<category>
  if (data.startsWith("cat:")) {
    const parts = data.split(":");
    const [, phonePart, empPart, ...catParts] = parts;
    const phoneNumber = decodeURIComponent(phonePart);
    const employeeName = decodeURIComponent(empPart);
    const category = decodeURIComponent(catParts.join(":"));

    await answerCallbackQuery(callbackId, `Category saved: ${category}`);

    const contact = await IdentifiedContact.findOneAndUpdate(
      { phoneNumber, employeeName },
      { $set: { category, identifiedAt: new Date(), telegramChatId: String(chatId) } },
      { upsert: true, new: true }
    );

    await UnknownNumberTracker.updateOne(
      { phoneNumber, employeeName },
      { $set: { status: "identified" } }
    );

    const name = contact.contactName || phoneNumber;
    await editMessageText(
      chatId,
      messageId,
      `✅ <b>Contact Classified</b>\n\nName: <b>${name}</b>\nCategory: <b>${category}</b>\nNumber: <code>${phoneNumber}</code>`
    );

    const saveText =
      `📱 <b>Please save this contact in your phone</b>\n\n` +
      `Name: <b>${name}</b>\n` +
      `Number: <code>${phoneNumber}</code>`;

    await sendInlineKeyboard(chatId, saveText, saveContactKeyboard(phoneNumber, employeeName));
    return;
  }

  // Saved confirmation: saved:<phone>:<employee>
  if (data.startsWith("saved:")) {
    const [, phonePart, empPart] = data.split(":");
    const phoneNumber = decodeURIComponent(phonePart);
    const employeeName = decodeURIComponent(empPart);

    await answerCallbackQuery(callbackId, "Great! Contact saved ✅");
    await IdentifiedContact.updateOne(
      { phoneNumber, employeeName },
      { $set: { savedInPhone: true, remindLater: false } }
    );
    await editMessageText(chatId, messageId, `✅ Perfect! Contact has been saved in your phone.`);
    return;
  }

  // Remind Later: remind:<phone>:<employee>
  if (data.startsWith("remind:")) {
    const [, phonePart, empPart] = data.split(":");
    const phoneNumber = decodeURIComponent(phonePart);
    const employeeName = decodeURIComponent(empPart);

    await answerCallbackQuery(callbackId, "We'll remind you later ⏰");
    await IdentifiedContact.updateOne(
      { phoneNumber, employeeName },
      { $set: { remindLater: true } }
    );
    await editMessageText(
      chatId,
      messageId,
      `⏰ Reminder set. We'll remind you next time this number appears.`
    );
    return;
  }

  await answerCallbackQuery(callbackId);
}

// ── Message Handler ────────────────────────────────────────────────────────

async function handleMessage(message: any) {
  const chatId: number = message.chat?.id;
  const text: string = (message.text ?? "").trim();
  const replyToMessageId: number | undefined = message.reply_to_message?.message_id;

  // ── 1. /start command — begin self-registration ────────────────────────
  if (text === "/start") {
    const existing = await EmployeeTelegram.findOne({ telegramChatId: String(chatId) });
    if (existing) {
      await sendMessage(
        chatId,
        `👋 Welcome back, <b>${existing.employeeName}</b>!\n\nYou are already registered in the system.\n\nYour Telegram is connected to the call log intelligence system.`
      );
      return;
    }

    await sendMessage(
      chatId,
      `👋 <b>Welcome to the Call Log System</b>\n\n` +
        `To register, please send your <b>employee phone number</b> used in the call logs app.\n\n` +
        `Example:\n<code>9876543210</code>`
    );
    return;
  }

  // ── 2. Reply-based contact name identification ─────────────────────────
  if (replyToMessageId) {
    const tracker = await UnknownNumberTracker.findOne({
      telegramMessageId: replyToMessageId,
      status: "awaiting_name",
    });

    if (tracker) {
      const { phoneNumber, employeeName } = tracker;
      const contactName = text;

      await IdentifiedContact.findOneAndUpdate(
        { phoneNumber, employeeName },
        {
          $set: { contactName, telegramChatId: String(chatId), deviceId: tracker.deviceId },
          $setOnInsert: { phoneNumber, employeeName },
        },
        { upsert: true, new: true }
      );

      tracker.status = "awaiting_category";
      await tracker.save();

      const categoryText =
        `✅ <b>Name saved!</b>\n\n` +
        `Name: <b>${contactName}</b>\n` +
        `Number: <code>${phoneNumber}</code>\n\n` +
        `Please select the category:`;

      await sendInlineKeyboard(chatId, categoryText, categoryKeyboard(phoneNumber, employeeName));
      return;
    }
    // Fall through to phone registration check
  }

  // ── 3. Phone number — self-registration verification ───────────────────
  const digitsOnly = text.replace(/[\s\-\+]/g, "");
  const isPhoneNumber = /^\d{10,13}$/.test(digitsOnly);

  if (isPhoneNumber) {
    const alreadyLinked = await EmployeeTelegram.findOne({ telegramChatId: String(chatId) });
    if (alreadyLinked) {
      await sendMessage(
        chatId,
        `✅ You are already registered as <b>${alreadyLinked.employeeName}</b>.`
      );
      return;
    }

    const last10 = digitsOnly.slice(-10);

    const employee = await EmployeeTelegram.findOne({
      $or: [
        { phoneNumber: digitsOnly },
        { phoneNumber: last10 },
        { phoneNumber: { $regex: `${last10}$` } },
      ],
      telegramChatId: null,
    });

    if (!employee) {
      const taken = await EmployeeTelegram.findOne({
        $or: [
          { phoneNumber: digitsOnly },
          { phoneNumber: last10 },
          { phoneNumber: { $regex: `${last10}$` } },
        ],
        telegramChatId: { $ne: null },
      });

      if (taken) {
        await sendMessage(
          chatId,
          `⚠️ This phone number is already linked to another Telegram account.\n\nPlease contact the administrator.`
        );
      } else {
        await sendMessage(
          chatId,
          `❌ <b>This phone number is not registered in the system.</b>\n\nPlease contact the administrator to be added.`
        );
      }
      return;
    }

    // Ensure companyId is set (required by schema); resolve from call logs if missing (e.g. legacy records)
    if (!employee.companyId) {
      const resolved = await resolveCompanyIdForEmployee(digitsOnly, employee.employeeName);
      if (resolved) {
        employee.companyId = resolved;
      } else {
        const defaultId = process.env.DEFAULT_COMPANY_ID;
        if (defaultId && mongoose.Types.ObjectId.isValid(defaultId)) {
          employee.companyId = new mongoose.Types.ObjectId(defaultId);
        } else {
          await sendMessage(
            chatId,
            `❌ <b>Could not complete registration.</b>\n\nYour number is in the system but company could not be determined. Please ask your administrator to add you from the <b>Telegram Setup</b> page in the dashboard, then try again.`
          );
          return;
        }
      }
    }

    employee.telegramChatId = String(chatId);
    employee.registeredAt = new Date();
    await employee.save();

    await sendMessage(
      chatId,
      `✅ <b>Registration successful!</b>\n\n` +
        `Employee: <b>${employee.employeeName}</b>\n` +
        `Telegram connected successfully.\n\n` +
        `You will now receive contact classification requests from the call log system.`
    );
    return;
  }

  // ── 4. Unknown message (only respond to unregistered users) ──────────────
  const isRegistered = await EmployeeTelegram.findOne({ telegramChatId: String(chatId) });
  if (!isRegistered) {
    await sendMessage(
      chatId,
      `❓ I didn't understand that.\n\nSend <code>/start</code> to begin registration.`
    );
  }
}
