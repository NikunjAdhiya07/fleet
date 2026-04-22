import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";
import { normalizePhoneNumber } from "@/lib/phone";

/**
 * POST /api/contact-intelligence/tags-bulk
 *
 * Body: { pairs: Array<{ phoneNumber: string; employeeName: string }> }
 * Returns: { tags: Record<string, { category?: string; contactName?: string }> }
 * Key is "phoneNumber|employeeName" for lookup in call logs.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const pairs = body.pairs as Array<{ phoneNumber: string; employeeName: string }>;
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return NextResponse.json({ tags: {} });
  }

  await connectToDatabase();

  const last10 = (phone: string) => String(phone ?? "").replace(/\D/g, "").slice(-10);
  const normalizeToLast10 = (phone: string) => {
    const norm = normalizePhoneNumber(String(phone ?? ""));
    return last10(norm) || last10(phone);
  };

  const normalizedPairs = pairs
    .map((p) => ({
      phoneNumber: normalizeToLast10(p.phoneNumber),
      employeeName: p.employeeName,
      originalKey: `${p.phoneNumber}|${p.employeeName}`,
    }))
    .filter((p) => p.phoneNumber && p.phoneNumber.length >= 10);

  const keys = new Set(normalizedPairs.map((p) => `${p.phoneNumber}|${p.employeeName}`));
  const phoneNumbers = [...new Set(normalizedPairs.map((p) => p.phoneNumber))];
  const employeeNames = [...new Set(normalizedPairs.map((p) => p.employeeName))];

  // Include global Excel-imported entries stored under employeeName="ALL" as a fallback match.
  const contacts = await IdentifiedContact.find({
    phoneNumber: { $in: phoneNumbers },
    employeeName: { $in: [...employeeNames, "ALL"] },
  })
    .select("phoneNumber employeeName category contactName")
    .lean();

  const tags: Record<string, { category?: string; contactName?: string }> = {};
  const byPair = new Map<string, { category?: string; contactName?: string }>();
  for (const c of contacts as any[]) {
    const key = `${c.phoneNumber}|${c.employeeName}`;
    const v: { category?: string; contactName?: string } = {};
    if (c.category) v.category = c.category;
    if (c.contactName && String(c.contactName).trim()) v.contactName = String(c.contactName).trim();
    byPair.set(key, v);
  }

  // Resolve tags for each requested pair: prefer employee-specific, else fallback to ALL.
  for (const p of normalizedPairs) {
    const empKey = `${p.phoneNumber}|${p.employeeName}`;
    const globalKey = `${p.phoneNumber}|ALL`;
    const hit = byPair.get(empKey) ?? byPair.get(globalKey);
    if (!hit) continue;
    if (keys.has(empKey)) tags[empKey] = hit;
  }

  return NextResponse.json({ tags });
}
