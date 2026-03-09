/**
 * Contact Intelligence Engine
 * Called after every call log is saved from the Android app.
 *
 * Decision tree:
 * 1. Check IdentifiedContact — if fully identified (name + category) → do nothing
 * 2. Check Contact (phone contacts) — if number is saved in phone:
 *    a. If IdentifiedContact exists but has no category → send category keyboard
 *    b. If no IdentifiedContact → create one (use contactName from phone), send category keyboard
 * 3. If not in phone contacts:
 *    a. Upsert UnknownNumberTracker, increment callCount
 *    b. If callCount reaches threshold (5) and status is 'tracking' → send name request
 * 4. Smart reminder: if IdentifiedContact exists but savedInPhone=false → send reminder (once per call)
 */

import connectToDatabase from '@/lib/db';
import Contact from '@/models/Contact';
import IdentifiedContact from '@/models/IdentifiedContact';
import UnknownNumberTracker from '@/models/UnknownNumberTracker';
import EmployeeTelegram from '@/models/EmployeeTelegram';
import {
  sendInlineKeyboard,
  sendReplyRequest,
  categoryKeyboard,
  saveContactKeyboard,
  sendMessage,
} from '@/lib/telegram';

const CALL_THRESHOLD = 5;

export async function runContactIntelligence(
  phoneNumber: string,
  contactName: string | undefined,
  employeeName: string,
  deviceId: string
) {
  try {
    await connectToDatabase();

    // ── Fetch the employee's Telegram chat ID ──────────────────────────────
    const empTelegram = await EmployeeTelegram.findOne({ employeeName }).lean() as any;
    const chatId: string | null = empTelegram?.telegramChatId ?? null;

    // ── 1. Check if already fully identified ──────────────────────────────
    const identified = await IdentifiedContact.findOne({
      phoneNumber,
      employeeName,
    });

    if (identified?.contactName && identified?.category) {
      // Fully known — only send smart reminder if not saved in phone
      if (!identified.savedInPhone && !identified.remindLater && chatId) {
        await sendSmartReminder(chatId, phoneNumber, identified.contactName, identified.category);
      }
      return;
    }

    // ── 2. Check phone contacts (Contact model) ────────────────────────────
    const phoneContact = await Contact.findOne({ deviceId, phoneNumber }).lean() as any;

    if (phoneContact) {
      // Number IS saved in phone contacts — we only need the category
      const name = phoneContact.contactName || contactName || 'Unknown';

      if (!identified) {
        // Create a placeholder IdentifiedContact with the name from phone
        await IdentifiedContact.create({
          phoneNumber,
          employeeName,
          deviceId,
          contactName: name,
          telegramChatId: chatId ?? undefined,
        });
      }

      // Send category keyboard if we have a chat ID
      if (chatId) {
        await sendCategoryRequest(chatId, name, phoneNumber, employeeName);
      }
      return;
    }

    // ── 3. Unknown number — track frequency ───────────────────────────────
    const now = new Date();
    const existing = await UnknownNumberTracker.findOne({ phoneNumber, employeeName });

    if (existing) {
      // Already tracking
      if (existing.status !== 'tracking') {
        // Already asked / identified — no action, but check reminder
        if (identified && !identified.savedInPhone && !identified.remindLater && chatId) {
          await sendSmartReminder(chatId, phoneNumber, identified.contactName ?? phoneNumber, identified.category ?? '');
        }
        return;
      }

      existing.callCount += 1;
      existing.lastSeen = now;
      await existing.save();

      if (existing.callCount >= CALL_THRESHOLD && chatId) {
        // Threshold reached — ask for name
        const result = await sendNameRequest(chatId, phoneNumber, employeeName, existing.callCount);
        const messageId = result?.result?.message_id;

        existing.status = 'awaiting_name';
        if (messageId) existing.telegramMessageId = messageId;
        await existing.save();
      }
    } else {
      // First time seeing this number — create tracker
      await UnknownNumberTracker.create({
        phoneNumber,
        employeeName,
        deviceId,
        callCount: 1,
        firstSeen: now,
        lastSeen: now,
        status: 'tracking',
      });
      // 1 call — no message yet
    }
  } catch (err) {
    console.error('[ContactIntelligence] Error:', err);
    // Non-blocking — never throw back to the call API
  }
}

// ── Helper message senders ─────────────────────────────────────────────────

async function sendCategoryRequest(
  chatId: string,
  contactName: string,
  phoneNumber: string,
  employeeName: string
) {
  const text =
    `📞 <b>Please classify this contact</b>\n\n` +
    `Employee: <b>${employeeName}</b>\n` +
    `Contact Name: <b>${contactName}</b>\n` +
    `Number: <code>${phoneNumber}</code>\n\n` +
    `Who is this person?`;

  await sendInlineKeyboard(chatId, text, categoryKeyboard(phoneNumber, employeeName));
}

async function sendNameRequest(
  chatId: string,
  phoneNumber: string,
  employeeName: string,
  callCount: number
) {
  const text =
    `⚠️ <b>Contact Identification Needed</b>\n\n` +
    `Employee: <b>${employeeName}</b>\n` +
    `Number: <code>${phoneNumber}</code>\n` +
    `Call Count: <b>${callCount}</b>\n\n` +
    `This number has appeared <b>${callCount} times</b> in call logs.\n\n` +
    `Please <b>reply to this message</b> with the contact name.\n\n` +
    `Example:\n<i>Jignesh</i>`;

  return sendReplyRequest(chatId, text);
}

async function sendSmartReminder(
  chatId: string,
  phoneNumber: string,
  contactName: string,
  category: string
) {
  const text =
    `🔔 <b>Reminder</b>\n\n` +
    `You previously identified this contact:\n\n` +
    `Name: <b>${contactName}</b>\n` +
    `Category: <b>${category}</b>\n` +
    `Number: <code>${phoneNumber}</code>\n\n` +
    `But this number is still <b>not saved</b> in your phone contacts.\n` +
    `Please save it.`;

  await sendInlineKeyboard(chatId, text, saveContactKeyboard(phoneNumber, contactName));
}
