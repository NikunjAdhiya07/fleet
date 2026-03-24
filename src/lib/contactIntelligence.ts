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
/** Cooldown for "save contact in phone" reminders after the contact is fully classified. */
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

      // One category Telegram per (phone, employee) until category is chosen — atomic claim avoids duplicates under concurrent calls / process retries
      if (chatId) {
        const claimed = await IdentifiedContact.findOneAndUpdate(
          {
            phoneNumber,
            employeeName,
            contactName: { $exists: true, $nin: [null, ''] },
            category: null,
            categoryRequestSentAt: null,
          },
          { $set: { categoryRequestSentAt: new Date() } },
          { new: true }
        );

        if (!claimed) {
          await log(
            'info',
            'SKIP_CATEGORY_ALREADY_SENT',
            `Category Telegram already sent for "${name}" — not sending again until category is chosen`,
            undefined,
            employeeName,
            phoneNumber
          );
          return;
        }

        await log('info', 'SENDING_CATEGORY', `Sending category keyboard to chatId ${chatId} for "${name}"`, undefined, employeeName, phoneNumber);
        const result = await sendCategoryRequest(chatId, name, phoneNumber, employeeName);
        const sent = result?.ok === true;
        if (sent) {
          await log('success', 'MESSAGE_SENT', `Category keyboard sent successfully`, { telegramResult: result }, employeeName, phoneNumber);
        } else {
          await IdentifiedContact.updateOne({ phoneNumber, employeeName }, { $unset: { categoryRequestSentAt: 1 } });
          await log(
            'error',
            'MESSAGE_SEND_FAILED',
            `Category keyboard failed — cleared claim for retry`,
            { telegramResult: result },
            employeeName,
            phoneNumber
          );
        }
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

    if (tracker.callCount >= CALL_THRESHOLD && chatId) {
      if (tracker.status === 'tracking') {
        // Only one concurrent flow may pass threshold → awaiting_name; avoids duplicate Telegram on 6th+ calls or parallel requests
        const transitioned = await UnknownNumberTracker.findOneAndUpdate(
          { _id: tracker._id, status: 'tracking', callCount: { $gte: CALL_THRESHOLD } },
          { $set: { status: 'awaiting_name' } },
          { new: true }
        );

        if (!transitioned) {
          await log(
            'info',
            'SKIP_NAME_THRESHOLD_RACE',
            `Threshold already handled by another request for ${phoneNumber}`,
            undefined,
            employeeName,
            phoneNumber
          );
        } else {
          await log(
            'info',
            'THRESHOLD_REACHED',
            `Threshold of ${CALL_THRESHOLD} calls reached — sending name request to chatId ${chatId}`,
            undefined,
            employeeName,
            phoneNumber
          );
          const result = await sendNameRequest(chatId, phoneNumber, employeeName, transitioned.callCount);
          const sent = result?.ok === true;
          const messageId = result?.result?.message_id;

          if (sent) {
            const setFields: Record<string, unknown> = { nameRequestSentAt: new Date() };
            if (messageId != null) setFields.telegramMessageId = messageId;
            await UnknownNumberTracker.updateOne({ _id: tracker._id }, { $set: setFields });
            await log(
              'success',
              'NAME_REQUEST_SENT',
              `Name request sent — messageId: ${messageId}`,
              { telegramResult: result },
              employeeName,
              phoneNumber
            );
          } else {
            await UnknownNumberTracker.updateOne({ _id: tracker._id }, { $set: { status: 'tracking' } });
            await log(
              'error',
              'NAME_REQUEST_FAILED',
              `Failed to send Telegram name request (ok=${result?.ok}) — reverted to tracking for retry`,
              { telegramResult: result },
              employeeName,
              phoneNumber
            );
          }
        }
      } else if (
        tracker.status === 'awaiting_name' &&
        !tracker.telegramMessageId &&
        !tracker.nameRequestSentAt
      ) {
        await log(
          'info',
          'NAME_REQUEST_RETRY',
          `Retrying name request (never successfully sent) for ${phoneNumber}`,
          undefined,
          employeeName,
          phoneNumber
        );
        const result = await sendNameRequest(chatId, phoneNumber, employeeName, tracker.callCount ?? CALL_THRESHOLD);
        if (result?.ok === true) {
          const setFields: Record<string, unknown> = { nameRequestSentAt: new Date() };
          if (result?.result?.message_id != null) {
            setFields.telegramMessageId = result.result.message_id;
          }
          await UnknownNumberTracker.updateOne({ _id: tracker._id }, { $set: setFields });
          await log('success', 'NAME_REQUEST_RETRY_SENT', `Name request sent on retry`, { telegramResult: result }, employeeName, phoneNumber);
        }
      }
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

/**
 * Daily 8 AM job: resend only stale pending prompts.
 * Rule:
 * - Do NOT spam daily.
 * - Re-send Scenario A / B only if the last successful prompt is older than 2 days and still unresolved.
 */
export async function runDailyPendingReminders(): Promise<{ category: number; nameRequest: number; saveReminder: number }> {
  await connectToDatabase();
  const counts = { category: 0, nameRequest: 0, saveReminder: 0 };
  const now = new Date();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  // 1. Scenario A: unresolved category and last category prompt is older than 2 days
  const pendingCategory = await IdentifiedContact.find({
    contactName: { $exists: true, $nin: [null, ''] },
    $or: [{ category: null }, { category: { $exists: false } }],
    telegramChatId: { $exists: true, $nin: [null, ''] },
    categoryRequestSentAt: { $lte: twoDaysAgo },
  }).lean() as any[];

  for (const c of pendingCategory) {
    try {
      const result = await sendCategoryRequest(c.telegramChatId, c.contactName, c.phoneNumber, c.employeeName);
      if (result?.ok === true) {
        await IdentifiedContact.updateOne(
          { phoneNumber: c.phoneNumber, employeeName: c.employeeName },
          { $set: { categoryRequestSentAt: new Date() } }
        );
        counts.category++;
      }
    } catch (err) {
      console.error(`[DailyReminder] Category send failed for ${c.phoneNumber}:`, err);
    }
  }

  // 2. Scenario B: awaiting name and last name-request prompt is older than 2 days
  const pendingName = await UnknownNumberTracker.find({
    status: 'awaiting_name',
    nameRequestSentAt: { $lte: twoDaysAgo },
  }).lean() as any[];
  for (const t of pendingName) {
    try {
      const emp = await EmployeeTelegram.findOne({ employeeName: new RegExp(`^${escapeRegex(t.employeeName)}$`, 'i') }).lean() as any;
      const chatId = emp?.telegramChatId;
      if (!chatId) continue;
      const result = await sendNameRequest(chatId, t.phoneNumber, t.employeeName, t.callCount ?? 5);
      if (result?.ok === true) {
        const setFields: Record<string, unknown> = { nameRequestSentAt: new Date() };
        if (result?.result?.message_id != null) {
          setFields.telegramMessageId = result.result.message_id;
        }
        await UnknownNumberTracker.updateOne({ _id: t._id }, { $set: setFields });
        counts.nameRequest++;
      }
    } catch (err) {
      console.error(`[DailyReminder] Name request send failed for ${t.phoneNumber}:`, err);
    }
  }

  // 3. Save reminder: IdentifiedContact with category but not saved, not remindLater
  const pendingSave = await IdentifiedContact.find({
    contactName: { $exists: true, $ne: null },
    category: { $exists: true, $ne: null },
    savedInPhone: false,
    remindLater: { $ne: true },
    telegramChatId: { $exists: true, $nin: [null, ''] },
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
