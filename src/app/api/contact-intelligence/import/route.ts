import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";
import { normalizePhoneNumber } from "@/lib/phone";
import * as XLSX from "xlsx";

export const maxDuration = 60;

type ImportRow = {
  phoneNumberRaw: string;
  phoneNumber: string; // normalized (last 10 digits)
  contactName?: string;
  category?: string;
};

function last10Digits(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.slice(-10);
}

function normalizeToLast10(phone: string): string {
  const norm = normalizePhoneNumber(String(phone ?? ""));
  const last10 = last10Digits(norm);
  return last10 || last10Digits(phone);
}

function normalizeCategory(input: unknown): string | undefined {
  const raw = String(input ?? "").trim();
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (s === "staff") return "staff";
  if (s === "personal") return "personal";
  if (s === "courier") return "courier";
  if (s === "family") return "Family";
  if (s === "colleague") return "Colleague";
  if (s === "other") return "Other";
  if (s === "existing client" || s === "existing_client" || s === "existingclient") return "Existing Client";
  if (s === "new client" || s === "new_client" || s === "newclient") return "New Client";
  // Allow exact title-case values already used in UI
  if (raw === "Existing Client" || raw === "New Client" || raw === "Family" || raw === "Colleague" || raw === "Other") return raw;
  return raw;
}

function normalizeHeaderCell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isHeaderLikeRow(cells: unknown[]): boolean {
  const s = cells.map(normalizeHeaderCell);
  const hasMobile = s.some((c) => c === "mobile number" || c === "mobile" || c === "phone number" || c === "phone");
  const hasCategory = s.some((c) => c === "category" || c === "type" || c === "category / type" || c === "category/type");
  const hasName = s.some((c) => c.startsWith("name"));
  return hasMobile && hasCategory && hasName;
}

function parseWorkbookRows(buf: ArrayBuffer): ImportRow[] {
  const data = new Uint8Array(buf);
  const wb = XLSX.read(data, { type: "array" });
  const out: ImportRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][];
    if (!Array.isArray(grid) || grid.length === 0) continue;

    // Your uploaded format has a title row and the header can appear after some blank rows.
    const headerIdx = grid.findIndex((r) => Array.isArray(r) && isHeaderLikeRow(r));
    if (headerIdx < 0) continue;

    const header = grid[headerIdx].map(normalizeHeaderCell);
    const colIndex = (pred: (h: string) => boolean) => header.findIndex(pred);

    const mobileCol = colIndex((h) => h === "mobile number" || h === "mobile" || h === "phone number" || h === "phone");
    const categoryCol = colIndex((h) => h === "category" || h === "type" || h === "category / type" || h === "category/type");
    // Prefer "Name (Enter here)" if present in your file
    const nameEnterCol = colIndex((h) => h === "name (enter here)");
    const nameCol = colIndex((h) => h === "name" || h === "contact name" || h === "name (current)");
    const finalNameCol = nameEnterCol >= 0 ? nameEnterCol : nameCol;

    if (mobileCol < 0 || categoryCol < 0 || finalNameCol < 0) continue;

    for (let i = headerIdx + 1; i < grid.length; i++) {
      const row = grid[i] ?? [];
      if (!Array.isArray(row)) continue;

      const phone = String(row[mobileCol] ?? "").trim();
      const normalized = normalizeToLast10(phone);
      if (!normalized || normalized.length < 10) continue;

      const name = String(row[finalNameCol] ?? "").trim();
      const category = String(row[categoryCol] ?? "").trim();

      out.push({
        phoneNumberRaw: phone,
        phoneNumber: normalized,
        contactName: name || undefined,
        category: normalizeCategory(category),
      });
    }
  }

  // Dedup across workbook (last one wins)
  const byPhone = new Map<string, ImportRow>();
  for (const r of out) byPhone.set(r.phoneNumber, r);
  return [...byPhone.values()];
}

function validateRow(r: ImportRow): { ok: true } | { ok: false; reason: string } {
  if (!r.phoneNumber || r.phoneNumber.length < 10) return { ok: false, reason: "invalid_phone" };
  const hasName = !!(r.contactName && r.contactName.trim());
  const hasCategory = !!(r.category && String(r.category).trim());
  if (!hasName && !hasCategory) return { ok: false, reason: "missing_name_and_category" };
  return { ok: true };
}

/**
 * POST /api/contact-intelligence/import
 * multipart/form-data: file=<xlsx|xls|csv>
 *
 * Imports contacts as global identified contacts (employeeName="ALL") so they match all employees.
 * Upserts by (phoneNumber, employeeName).
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const filename = file.name || "upload";
  const ext = filename.toLowerCase().split(".").pop() || "";
  if (!["xlsx", "xls", "csv"].includes(ext)) {
    return NextResponse.json({ error: "Unsupported file type. Use .xlsx, .xls, or .csv" }, { status: 400 });
  }

  const buf = await file.arrayBuffer();
  const rows = parseWorkbookRows(buf);
  if (rows.length === 0) {
    return NextResponse.json({
      imported: 0,
      updated: 0,
      skipped: 0,
      message:
        "No valid rows found. This uploader expects your existing format with a header row containing Mobile Number / Name / Category.",
    });
  }

  await connectToDatabase();

  const now = new Date();
  const employeeName = "ALL";

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};

  for (const r of rows) {
    const v = validateRow(r);
    if (!v.ok) {
      skipped++;
      skipReasons[v.reason] = (skipReasons[v.reason] ?? 0) + 1;
      continue;
    }
    const update: Record<string, unknown> = {
      identifiedAt: now,
      remindLater: false,
    };
    if (r.contactName) update.contactName = r.contactName;
    if (r.category) update.category = r.category;

    const res = await IdentifiedContact.findOneAndUpdate(
      { phoneNumber: r.phoneNumber, employeeName },
      {
        $set: update,
        $setOnInsert: {
          phoneNumber: r.phoneNumber,
          employeeName,
          deviceId: "",
          savedInPhone: false,
        },
      },
      { upsert: true, new: false }
    ).lean();

    if (res) updated++;
    else imported++;
  }

  return NextResponse.json({
    imported,
    updated,
    skipped,
    totalRows: rows.length,
    skipReasons,
  });
}

