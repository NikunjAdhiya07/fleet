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
        // Set timestamp BEFORE sending to prevent race conditions
        await IdentifiedContact.updateOne(
          { phoneNumber, employeeName },
          { $set: { lastReminderSentAt: new Date() } }
        );
        await log('info', 'REMINDER', `Sending save-to-phone reminder`, undefined, employeeName, phoneNumber);
        await sendSmartReminder(chatId, phoneNumber, employeeName, identified.contactName, identified.category);
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
        // Set timestamp BEFORE sending to prevent race conditions with concurrent runs
        await IdentifiedContact.updateOne(
          { phoneNumber, employeeName },
          { $set: { categoryRequestSentAt: new Date() } }
        );
        await log('info', 'SENDING_CATEGORY', `Sending category keyboard to chatId ${chatId} for "${name}"`, undefined, employeeName, phoneNumber);
        const result = await sendCategoryRequest(chatId, name, phoneNumber, employeeName);
        await log('success', 'MESSAGE_SENT', `Category keyboard sent successfully`, { telegramResult: result }, employeeName, phoneNumber);
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
      // Set status BEFORE sending to prevent race conditions with concurrent runs
      tracker.status = 'awaiting_name';
      await tracker.save();

      const result = await sendNameRequest(chatId, phoneNumber, employeeName, tracker.callCount);
      const sent = result?.ok === true;
      const messageId = result?.result?.message_id;

      if (sent) {
        if (messageId) tracker.telegramMessageId = messageId;
        await tracker.save();
        await log('success', 'NAME_REQUEST_SENT', `Name request sent — messageId: ${messageId}`, { telegramResult: result }, employeeName, phoneNumber);
      } else {
        await log('error', 'NAME_REQUEST_FAILED', `Failed to send Telegram name request (ok=${result?.ok}) — will retry on next run`, { telegramResult: result }, employeeName, phoneNumber);
      }

    } else if (tracker.status === 'tracking' && tracker.callCount >= CALL_THRESHOLD && !chatId) {
      await log('warn', 'THRESHOLD_NO_CHATID', `5 calls reached but employee "${employeeName}" has no Telegram linked — cannot send name request`, undefined, employeeName, phoneNumber);

    } else if (tracker.status === 'awaiting_name' && chatId && !tracker.telegramMessageId) {
      await log('info', 'NAME_REQUEST_RETRY', `Retrying name request (no messageId stored) for ${phoneNumber}`, undefined, employeeName, phoneNumber);
      const result = await sendNameRequest(chatId, phoneNumber, employeeName, tracker.callCount ?? CALL_THRESHOLD);
      if (result?.ok === true && result?.result?.message_id) {
        tracker.telegramMessageId = result.result.message_id;
        await tracker.save();
        await log('success', 'NAME_REQUEST_RETRY_SENT', `Name request sent on retry — messageId: ${tracker.telegramMessageId}`, undefined, employeeName, phoneNumber);
      }

    } else if (tracker.status !== 'tracking' && tracker.status !== 'awaiting_name' && tracker.status !== 'awaiting_category') {
      const lastReminderAt = identified?.lastReminderSentAt ? new Date(identified.lastReminderSentAt).getTime() : 0;
      const reminderCooldown = lastReminderAt && Date.now() - lastReminderAt < CATEGORY_REQUEST_COOLDOWN_MS;
      if (identified && !identified.savedInPhone && !identified.remindLater && chatId && !reminderCooldown) {
        // Set timestamp BEFORE sending to prevent race conditions
        await IdentifiedContact.updateOne(
          { phoneNumber, employeeName },
          { $set: { lastReminderSentAt: new Date() } }
        );
        await sendSmartReminder(chatId, phoneNumber, employeeName, identified.contactName ?? null, identified.category ?? '');
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

/**
 * Daily 8 AM job: re-send Telegram messages for all pending items (no reply yet).
 * - Scenario A: contact has name but no category → send category keyboard again
 * - Scenario B: tracker awaiting_name → send name request again
 * - Save reminder: contact has category but not savedInPhone → send confirmation again
 */
export async function runDailyPendingReminders(): Promise<{ category: number; nameRequest: number; saveReminder: number }> {
  await connectToDatabase();
  const counts = { category: 0, nameRequest: 0, saveReminder: 0 };
  const now = new Date();

  // 1. Scenario A: IdentifiedContact with name but no category — re-send category keyboard
  //    Skip if category request was already sent within the last 24h
  const categoryCooldownCutoff = new Date(Date.now() - CATEGORY_REQUEST_COOLDOWN_MS);
  const pendingCategory = await IdentifiedContact.find({
    contactName: { $exists: true, $nin: [null, ''] },
    telegramChatId: { $exists: true, $nin: [null, ''] },
    $and: [
      { $or: [{ category: null }, { category: { $exists: false } }] },
      { $or: [
        { categoryRequestSentAt: null },
        { categoryRequestSentAt: { $exists: false } },
        { categoryRequestSentAt: { $lt: categoryCooldownCutoff } },
      ]},
    ],
  }).lean() as any[];

  for (const c of pendingCategory) {
    try {
      await sendCategoryRequest(c.telegramChatId, c.contactName, c.phoneNumber, c.employeeName);
      await IdentifiedContact.updateOne(
        { phoneNumber: c.phoneNumber, employeeName: c.employeeName },
        { $set: { categoryRequestSentAt: now } }
      );
      counts.category++;
    } catch (err) {
      console.error(`[DailyReminder] Category send failed for ${c.phoneNumber}:`, err);
    }
  }

  // 2. Scenario B: UnknownNumberTracker awaiting_name — re-send name request only
  //    if message was never delivered (no telegramMessageId)
  const pendingName = await UnknownNumberTracker.find({
    status: 'awaiting_name',
    $or: [{ telegramMessageId: null }, { telegramMessageId: { $exists: false } }],
  }).lean() as any[];
  for (const t of pendingName) {
    try {
      const emp = await EmployeeTelegram.findOne({ employeeName: new RegExp(`^${escapeRegex(t.employeeName)}$`, 'i') }).lean() as any;
      const chatId = emp?.telegramChatId;
      if (!chatId) continue;
      const result = await sendNameRequest(chatId, t.phoneNumber, t.employeeName, t.callCount ?? 5);
      if (result?.ok === true && result?.result?.message_id) {
        await UnknownNumberTracker.updateOne(
          { phoneNumber: t.phoneNumber, employeeName: t.employeeName },
          { $set: { telegramMessageId: result.result.message_id } }
        );
      }
      counts.nameRequest++;
    } catch (err) {
      console.error(`[DailyReminder] Name request send failed for ${t.phoneNumber}:`, err);
    }
  }

  // 3. Save reminder: IdentifiedContact with category but not saved, not remindLater
  //    Skip if reminder was already sent within the last 24h
  const reminderCooldownCutoff = new Date(Date.now() - CATEGORY_REQUEST_COOLDOWN_MS);
  const pendingSave = await IdentifiedContact.find({
    contactName: { $exists: true, $ne: null },
    category: { $exists: true, $ne: null },
    savedInPhone: false,
    remindLater: { $ne: true },
    telegramChatId: { $exists: true, $nin: [null, ''] },
    $or: [
      { lastReminderSentAt: null },
      { lastReminderSentAt: { $exists: false } },
      { lastReminderSentAt: { $lt: reminderCooldownCutoff } },
    ],
  }).lean() as any[];

  for (const c of pendingSave) {
    try {
      await sendSmartReminder(c.telegramChatId, c.phoneNumber, c.employeeName, c.contactName ?? null, c.category ?? '');
      await IdentifiedContact.updateOne(
        { phoneNumber: c.phoneNumber, employeeName: c.employeeName },
        { $set: { lastReminderSentAt: now } }
      );
      counts.saveReminder++;
    } catch (err) {
      console.error(`[DailyReminder] Save reminder failed for ${c.phoneNumber}:`, err);
    }
  }

  return counts;
}
