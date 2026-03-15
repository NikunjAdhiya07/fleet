import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";

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

  const keys = new Set(pairs.map((p) => `${p.phoneNumber}|${p.employeeName}`));
  const phoneNumbers = [...new Set(pairs.map((p) => p.phoneNumber))];
  const employeeNames = [...new Set(pairs.map((p) => p.employeeName))];

  const contacts = await IdentifiedContact.find({
    phoneNumber: { $in: phoneNumbers },
    employeeName: { $in: employeeNames },
  })
    .select("phoneNumber employeeName category contactName")
    .lean();

  const tags: Record<string, { category?: string; contactName?: string }> = {};
  for (const c of contacts as any[]) {
    const key = `${c.phoneNumber}|${c.employeeName}`;
    if (keys.has(key)) {
      tags[key] = {};
      if (c.category) tags[key].category = c.category;
      if (c.contactName && c.contactName.trim()) tags[key].contactName = c.contactName.trim();
    }
  }

  return NextResponse.json({ tags });
}
