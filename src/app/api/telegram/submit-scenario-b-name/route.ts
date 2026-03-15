import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import { sendInlineKeyboard, categoryKeyboard } from "@/lib/telegram";

/**
 * POST /api/telegram/submit-scenario-b-name
 *
 * Called from the Scenario B Web App (Enter name form).
 * Body: { contactName, phoneNumber, employeeName, chatId }
 * Updates IdentifiedContact + tracker and sends the category keyboard to the chat.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { contactName, phoneNumber, employeeName, chatId } = body;
    if (!contactName || !phoneNumber || !employeeName || !chatId) {
      return NextResponse.json(
        { error: "Missing contactName, phoneNumber, employeeName, or chatId" },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const tracker = await UnknownNumberTracker.findOne({
      phoneNumber,
      employeeName,
      status: "awaiting_name",
    });
    if (!tracker) {
      return NextResponse.json(
        { error: "No pending name request for this contact, or already submitted." },
        { status: 400 }
      );
    }

    await IdentifiedContact.findOneAndUpdate(
      { phoneNumber, employeeName },
      {
        $set: {
          contactName: contactName.trim(),
          telegramChatId: String(chatId),
          deviceId: tracker.deviceId ?? "",
        },
        $setOnInsert: { phoneNumber, employeeName },
      },
      { upsert: true, new: true }
    );

    tracker.status = "awaiting_category";
    await tracker.save();

    const categoryText =
      `✅ <b>Name saved!</b>\n\n` +
      `Name: <b>${contactName.trim()}</b>\n` +
      `Number: <code>${phoneNumber}</code>\n\n` +
      `Please select the category:`;

    await sendInlineKeyboard(chatId, categoryText, categoryKeyboard(phoneNumber, employeeName));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[submit-scenario-b-name]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
