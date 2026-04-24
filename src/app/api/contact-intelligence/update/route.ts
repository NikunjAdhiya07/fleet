import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";
import { normalizePhoneNumber } from "@/lib/phone";

/**
 * PATCH /api/contact-intelligence/update
 * Upsert a contact's contactName and/or category by phoneNumber + employeeName.
 * Used for inline editing directly from the call logs table.
 */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { phoneNumber, employeeName, contactName, category } = body;

  if (!phoneNumber || !employeeName) {
    return NextResponse.json({ error: "phoneNumber and employeeName are required" }, { status: 400 });
  }

  const last10 = (p: string) => String(p ?? "").replace(/\D/g, "").slice(-10);
  const normalized = last10(normalizePhoneNumber(String(phoneNumber))) || last10(String(phoneNumber));

  if (!normalized) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  await connectToDatabase();

  const update: Record<string, any> = {};
  if (contactName !== undefined) update.contactName = String(contactName).trim();
  if (category !== undefined) update.category = category;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const result = await IdentifiedContact.findOneAndUpdate(
    { phoneNumber: normalized, employeeName: String(employeeName) },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return NextResponse.json({
    phoneNumber: normalized,
    employeeName: String(employeeName),
    contactName: result.contactName,
    category: result.category,
  });
}
