import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";
import { sendInlineKeyboard, saveContactKeyboard } from "@/lib/telegram";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await connectToDatabase();

  const contact = await IdentifiedContact.findById(id);
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  if (!contact.telegramChatId) {
    return NextResponse.json(
      { error: "No Telegram chat ID for this employee" },
      { status: 422 }
    );
  }

  const displayName =
    contact.contactName && contact.contactName !== contact.phoneNumber
      ? contact.contactName
      : null;
  const detailLine = displayName
    ? `Name: <b>${displayName}</b>\nNumber: <code>${contact.phoneNumber}</code>`
    : `Number: <code>${contact.phoneNumber}</code>`;
  const text =
    `Confirm once you've saved this contact in your phone?\n\n` +
    detailLine;

  await sendInlineKeyboard(
    contact.telegramChatId,
    text,
    saveContactKeyboard(contact.phoneNumber, contact.employeeName)
  );

  // Reset remind_later so the reminder can fire again
  contact.remindLater = false;
  await contact.save();

  return NextResponse.json({ success: true });
}
