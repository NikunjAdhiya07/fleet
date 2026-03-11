/**
 * Telegram Bot API helper — uses native fetch, no external dependencies.
 * All functions are async and throw on Telegram API errors.
 */

import connectToDatabase from '@/lib/db';
import BotLog from '@/models/BotLog';

export type InlineButton = { text: string; callback_data: string };
export type InlineKeyboard = InlineButton[][];

async function callTelegram(method: string, body: object): Promise<any> {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) {
    const msg = '[Telegram] TELEGRAM_BOT_TOKEN is not set in environment variables — cannot send any messages.';
    console.warn(msg);
    try {
      await connectToDatabase();
      await BotLog.create({ level: 'error', step: 'TELEGRAM_NO_TOKEN', message: msg });
    } catch { /* ignore */ }
    return null;
  }

  const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
  let data: any;
  try {
    const res = await fetch(`${BASE_URL}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json();
  } catch (fetchErr: any) {
    const msg = `[Telegram] Network error calling ${method}: ${fetchErr?.message}`;
    console.error(msg);
    try {
      await connectToDatabase();
      await BotLog.create({ level: 'error', step: 'TELEGRAM_NETWORK_ERROR', message: msg, data: { method, error: fetchErr?.message } });
    } catch { /* ignore */ }
    return null;
  }

  if (!data.ok) {
    const msg = `[Telegram] API error on ${method}: ${data.description ?? JSON.stringify(data)}`;
    console.error(msg, data);
    try {
      await connectToDatabase();
      await BotLog.create({
        level: 'error',
        step: 'TELEGRAM_API_ERROR',
        message: msg,
        data: { method, requestBody: body, telegramResponse: data },
      });
    } catch { /* ignore */ }
  }
  return data;
}

/** Send a plain text message. Returns the sent message object. */
export async function sendMessage(chatId: string | number, text: string): Promise<any> {
  return callTelegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

/** Send a message with an inline keyboard. Returns the sent message object. */
export async function sendInlineKeyboard(
  chatId: string | number,
  text: string,
  keyboard: InlineKeyboard
): Promise<any> {
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });
}

/** Send a message asking the user to reply (force_reply). Returns the sent message. */
export async function sendReplyRequest(
  chatId: string | number,
  text: string
): Promise<any> {
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { force_reply: true, selective: true },
  });
}

/** Acknowledge a callback query (removes the spinner on button). */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<any> {
  return callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text ?? '',
  });
}

/** Edit the text of an existing message (e.g. after a button is pressed). */
export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string
): Promise<any> {
  return callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
  });
}

/** Register a webhook URL with Telegram. */
export async function setWebhook(url: string, secretToken?: string): Promise<any> {
  return callTelegram('setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query'],
  });
}

/** The standard category inline keyboard used in multiple messages. */
export function categoryKeyboard(phoneNumber: string, employeeName: string): InlineKeyboard {
  const encode = (cat: string) =>
    `cat:${encodeURIComponent(phoneNumber)}:${encodeURIComponent(employeeName)}:${encodeURIComponent(cat)}`;
  return [
    [
      { text: '👨‍👩‍👧 Family', callback_data: encode('Family') },
      { text: '🤝 Colleague', callback_data: encode('Colleague') },
    ],
    [
      { text: '✅ Existing Client', callback_data: encode('Existing Client') },
      { text: '🆕 New Client', callback_data: encode('New Client') },
    ],
    [{ text: '🔖 Other', callback_data: encode('Other') }],
  ];
}

/** The "save contact" confirmation keyboard. */
export function saveContactKeyboard(phoneNumber: string, employeeName: string): InlineKeyboard {
  return [
    [
      {
        text: '✅ Saved',
        callback_data: `saved:${encodeURIComponent(phoneNumber)}:${encodeURIComponent(employeeName)}`,
      },
      {
        text: '⏰ Remind Later',
        callback_data: `remind:${encodeURIComponent(phoneNumber)}:${encodeURIComponent(employeeName)}`,
      },
    ],
  ];
}
