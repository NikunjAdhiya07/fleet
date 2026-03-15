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
import BotLog from '@/models/BotLog';
import {
  sendInlineKeyboard,
  categoryKeyboard,
  saveContactKeyboard,
  sendMessage,
  nameRequestKeyboard,
} from '@/lib/telegram';

const CALL_THRESHOLD = 5;
/** Don't re-send "classify this contact" more than once per 24h to avoid spam. */
const CATEGORY_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function log(
  level: 'info' | 'warn' | 'error' | 'success',
  step: string,
  message: string,
  data?: Record<string, any>,
  employeeName?: string,
  phoneNumber?: string
) {
  try {
    console.log(`[BotLog][${level.toUpperCase()}][${step}] ${message}`, data ?? '');
    await BotLog.create({ level, step, message, data: data ?? null, employeeName, phoneNumber });
  } catch {
    // Never let logging break the pipeline
  }
}

export async function runContactIntelligence(
  phoneNumber: string,
  contactName: string | undefined,
  employeeName: string,
  deviceId: string
) {
  try {
    await connectToDatabase();

    await log('info', 'START', `Intelligence triggered`, { phoneNumber, contactName, employeeName, deviceId }, employeeName, phoneNumber);

    // ── Fetch the employee's Telegram chat ID (case-insensitive match) ───────
    const empTelegram = await EmployeeTelegram.findOne({ employeeName: new RegExp(`^${escapeRegex(employeeName)}$`, 'i') }).lean() as any;
    const chatId: string | null = empTelegram?.telegramChatId ?? null;

    await log(
      empTelegram ? (chatId ? 'success' : 'warn') : 'error',
      'LOOKUP_EMPLOYEE',
      empTelegram
        ? chatId
          ? `Employee "${employeeName}" found with chatId ${chatId}`
          : `Employee "${employeeName}" found in DB but Telegram NOT linked yet (no chatId) — employee must open bot and send /start + phone number`
        : `Employee "${employeeName}" NOT in EmployeeTelegram table — admin must add their phone number in Telegram Setup page first`,
      { empTelegramRecord: empTelegram ?? null },
      employeeName,
      phoneNumber
    );

    // ── 1. Check if already fully identified ──────────────────────────────
    const identified = await IdentifiedContact.findOne({ phoneNumber, employeeName });

    if (identified?.contactName && identified?.category) {
      await log('info', 'SKIP_FULLY_DONE', `Contact already fully classified — name: "${identified.contactName}", category: "${identified.category}"`, undefined, employeeName, phoneNumber);
      // Only send smart reminder if not saved in phone, and not sent recently (avoid spam)
      const lastReminderAt = identified.lastReminderSentAt ? new Date(identified.lastReminderSentAt).getTime() : 0;
      const reminderCooldown = Date.now() - lastReminderAt < CATEGORY_REQUEST_COOLDOWN_MS;
      if (!identified.savedInPhone && !identified.remindLater && chatId && !reminderCooldown) {
        await log('info', 'REMINDER', `Sending save-to-phone reminder`, undefined, employeeName, phoneNumber);
        await sendSmartReminder(chatId, phoneNumber, employeeName, identified.contactName, identified.category);
        await IdentifiedContact.updateOne(
          { phoneNumber, employeeName },
          { $set: { lastReminderSentAt: new Date() } }
        );
      }
      return;
    }

    // ── 2. Check phone contacts (Scenario A) ──────────────────────────────
    const isKnownContact = !!contactName && contactName !== 'Unknown';
    let phoneContactName = contactName;

    // Optional fallback to Contact model
    if (!isKnownContact) {
      const phoneContact = await Contact.findOne({ deviceId, phoneNumber }).lean() as any;
      if (phoneContact?.contactName) {
        phoneContactName = phoneContact.contactName;
        await log('info', 'CONTACT_DB_FALLBACK', `Found contact in DB: "${phoneContact.contactName}"`, undefined, employeeName, phoneNumber);
      }
    }

    if (phoneContactName && phoneContactName !== 'Unknown') {
      const name = phoneContactName;
      await log('info', 'SCENARIO_A', `Scenario A — known contact: "${name}"`, undefined, employeeName, phoneNumber);

      // Create IdentifiedContact if not exists (so we always have a record to attach category to)
      if (!identified) {
        await IdentifiedContact.create({
          phoneNumber,
          employeeName,
          deviceId,
          contactName: name,
          telegramChatId: chatId ?? undefined,
        });
        await log('info', 'IDENTIFIED_CREATED', `Created IdentifiedContact for "${name}"`, undefined, employeeName, phoneNumber);
      }

      // Send category request at most once per cooldown to avoid spam (same contact every 10s)
      const contactForCategory = await IdentifiedContact.findOne({ phoneNumber, employeeName }).lean();
      const lastSentAt = contactForCategory?.categoryRequestSentAt ? new Date((contactForCategory as any).categoryRequestSentAt).getTime() : 0;
      const withinCooldown = lastSentAt && Date.now() - lastSentAt < CATEGORY_REQUEST_COOLDOWN_MS;
      if (withinCooldown) {
        await log('info', 'SKIP_CATEGORY_COOLDOWN', `Already sent category request recently for "${name}" — skipping to avoid spam`, undefined, employeeName, phoneNumber);
        return;
      }

      if (chatId) {
        await log('info', 'SENDING_CATEGORY', `Sending category keyboard to chatId ${chatId} for "${name}"`, undefined, employeeName, phoneNumber);
        const result = await sendCategoryRequest(chatId, name, phoneNumber, employeeName);
        await log('success', 'MESSAGE_SENT', `Category keyboard sent successfully`, { telegramResult: result }, employeeName, phoneNumber);
        await IdentifiedContact.updateOne(
          { phoneNumber, employeeName },
          { $set: { categoryRequestSentAt: new Date() } }
        );
      } else {
        await log('warn', 'NO_CHATID', `Cannot send Telegram — employee "${employeeName}" has no linked Telegram chatId. They need to open the bot, send /start, then send their 10-digit phone number.`, undefined, employeeName, phoneNumber);
      }
      return;
    }

    // ── 3. Unknown number — track frequency ───────────────────────────────
    await log('info', 'SCENARIO_B', `Scenario B — unknown number (not in phone contacts)`, undefined, employeeName, phoneNumber);

    const now = new Date();

    const tracker = await UnknownNumberTracker.findOneAndUpdate(
      { phoneNumber, employeeName },
      {
        $inc: { callCount: 1 },
        $set: { lastSeen: now },
        $setOnInsert: { firstSeen: now, status: 'tracking', deviceId }
      },
      { upsert: true, new: true }
    );

    await log('info', 'TRACKER_UPDATED', `Call count: ${tracker.callCount}/${CALL_THRESHOLD}, status: "${tracker.status}"`, { tracker: { callCount: tracker.callCount, status: tracker.status } }, employeeName, phoneNumber);

    if (tracker.status === 'tracking' && tracker.callCount >= CALL_THRESHOLD && chatId) {
      await log('info', 'THRESHOLD_REACHED', `Threshold of ${CALL_THRESHOLD} calls reached — sending name request to chatId ${chatId}`, undefined, employeeName, phoneNumber);
      const result = await sendNameRequest(chatId, phoneNumber, employeeName, tracker.callCount);
      const messageId = result?.result?.message_id;

      tracker.status = 'awaiting_name';
      if (messageId) tracker.telegramMessageId = messageId;
      await tracker.save();
      await log('success', 'NAME_REQUEST_SENT', `Name request sent — messageId: ${messageId}`, { telegramResult: result }, employeeName, phoneNumber);

    } else if (tracker.status === 'tracking' && tracker.callCount >= CALL_THRESHOLD && !chatId) {
      await log('warn', 'THRESHOLD_NO_CHATID', `5 calls reached but employee "${employeeName}" has no Telegram linked — cannot send name request`, undefined, employeeName, phoneNumber);

    } else if (tracker.status !== 'tracking' && tracker.status !== 'awaiting_name' && tracker.status !== 'awaiting_category') {
      const lastReminderAt = identified?.lastReminderSentAt ? new Date(identified.lastReminderSentAt).getTime() : 0;
      const reminderCooldown = lastReminderAt && Date.now() - lastReminderAt < CATEGORY_REQUEST_COOLDOWN_MS;
      if (identified && !identified.savedInPhone && !identified.remindLater && chatId && !reminderCooldown) {
        await sendSmartReminder(chatId, phoneNumber, employeeName, identified.contactName ?? null, identified.category ?? '');
        await IdentifiedContact.updateOne(
          { phoneNumber, employeeName },
          { $set: { lastReminderSentAt: new Date() } }
        );
      }
    } else {
      await log('info', 'TRACKING', `Tracking ${tracker.callCount}/${CALL_THRESHOLD} calls — no action yet`, undefined, employeeName, phoneNumber);
    }

  } catch (err: any) {
    console.error('[ContactIntelligence] Error:', err);
    try {
      await BotLog.create({
        level: 'error',
        step: 'UNHANDLED_ERROR',
        message: err?.message ?? 'Unknown error in contactIntelligence',
        data: { stack: err?.stack },
        employeeName,
        phoneNumber,
      });
    } catch { /* ignore */ }
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
    `📞 <b>Scenario A — Please classify this contact</b>\n\n` +
    `Employee: <b>${employeeName}</b>\n` +
    `Contact Name: <b>${contactName}</b>\n` +
    `Number: <code>${phoneNumber}</code>\n\n` +
    `Who is this person?`;

  return sendInlineKeyboard(chatId, text, categoryKeyboard(phoneNumber, employeeName));
}

async function sendNameRequest(
  chatId: string,
  phoneNumber: string,
  employeeName: string,
  callCount: number
) {
  const text =
    `⚠️ <b>Scenario B — Contact Identification Needed</b>\n\n` +
    `Employee: <b>${employeeName}</b>\n` +
    `Number: <code>${phoneNumber}</code>\n` +
    `Call Count: <b>${callCount}</b>\n\n` +
    `This number has appeared <b>${callCount} times</b> in call logs.\n\n` +
    `Tap the button below to enter the contact name, or reply to this message with the name.`;

  return sendInlineKeyboard(chatId, text, nameRequestKeyboard(phoneNumber, employeeName, chatId));
}

async function sendSmartReminder(
  chatId: string,
  phoneNumber: string,
  employeeName: string,
  contactName: string | null,
  category: string
) {
  const displayName = contactName && contactName !== phoneNumber ? contactName : null;
  const detailLine = displayName
    ? `Name: <b>${displayName}</b>\nNumber: <code>${phoneNumber}</code>`
    : `Number: <code>${phoneNumber}</code>`;
  const text =
    `Confirm once you've saved this contact in your phone?\n\n` +
    detailLine;

  await sendInlineKeyboard(chatId, text, saveContactKeyboard(phoneNumber, employeeName));
}
