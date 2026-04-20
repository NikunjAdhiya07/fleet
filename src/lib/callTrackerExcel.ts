import path from "path";
import fs from "fs/promises";
import ExcelJS from "exceljs";

export const CALL_TRACKER_CATEGORIES = [
  "Personal",
  "Staff",
  "Existing Client",
  "New Client",
  "Courier",
] as const;

export type CallTrackerCategory = (typeof CALL_TRACKER_CATEGORIES)[number];

export type CallTrackerRow = {
  serialNumber: number;
  mobileNumber: string;
  name: string; // stored as "Unknown" when unknown
  callCount: number;
  category: "" | CallTrackerCategory;
};

function normalizeDigits(v: unknown) {
  return String(v ?? "").replace(/\D+/g, "");
}

function workbookPath() {
  // Allow using an existing/legacy workbook path without moving files.
  // Example in `web/.env.local`: CALL_TRACKER_XLSX_PATH=C:\Path\to\old-call-tracker.xlsx
  const override = process.env.CALL_TRACKER_XLSX_PATH;
  if (override && override.trim()) return override.trim();

  // Default: stored inside the Next.js project so it works in local dev.
  // (For Vercel/serverless this would need a DB or external storage.)
  return path.join(process.cwd(), "data", "call-tracker.xlsx");
}

async function ensureParentDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

function headerRowValues() {
  return ["Serial Number", "Mobile Number", "Name", "Call Count", "Category"];
}

function categoryValidationFormula() {
  // Excel list validation needs a quoted comma-separated string.
  const joined = CALL_TRACKER_CATEGORIES.join(",");
  return `"${joined}"`;
}

async function createTemplateIfMissing(filePath: string) {
  try {
    await fs.access(filePath);
    return;
  } catch {
    // continue
  }

  await ensureParentDir(filePath);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Calls");

  ws.addRow(headerRowValues());
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  ws.columns = [
    { key: "serialNumber", width: 14 },
    { key: "mobileNumber", width: 18 },
    { key: "name", width: 24 },
    { key: "callCount", width: 10 },
    { key: "category", width: 18 },
  ];

  // Apply validation to a generous range.
  for (let r = 2; r <= 10000; r++) {
    ws.getCell(`E${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [categoryValidationFormula()],
      showErrorMessage: true,
      errorStyle: "error",
      errorTitle: "Invalid category",
      error: `Category must be one of: ${CALL_TRACKER_CATEGORIES.join(", ")}`,
    };
  }

  await wb.xlsx.writeFile(filePath);
}

async function normalizeWorkbookAtPath(filePath: string) {
  // Ensure it has our expected sheet + headers + validation.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Calls") ?? wb.worksheets[0] ?? wb.addWorksheet("Calls");

  if (ws.rowCount === 0) {
    ws.addRow(headerRowValues());
  } else {
    const header = ws.getRow(1);
    const expected = headerRowValues();
    const current = expected.map((_, i) => String(header.getCell(i + 1).value ?? "").trim());
    const matches = current.every((v, i) => v.toLowerCase() === expected[i].toLowerCase());
    if (!matches) {
      // If the workbook has data but different headers/order, we still keep it readable
      // by overwriting row1 to match our structure (data stays in place by columns).
      ws.getRow(1).values = ["", ...expected];
      ws.getRow(1).font = { bold: true };
    }
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.columns = [
    { key: "serialNumber", width: 14 },
    { key: "mobileNumber", width: 18 },
    { key: "name", width: 24 },
    { key: "callCount", width: 10 },
    { key: "category", width: 18 },
  ];

  // Apply category validation to a generous range.
  for (let r = 2; r <= 10000; r++) {
    ws.getCell(`E${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [categoryValidationFormula()],
      showErrorMessage: true,
      errorStyle: "error",
      errorTitle: "Invalid category",
      error: `Category must be one of: ${CALL_TRACKER_CATEGORIES.join(", ")}`,
    };
  }

  await wb.xlsx.writeFile(filePath);
}

function worksheetToRows(ws: ExcelJS.Worksheet): CallTrackerRow[] {
  const rows: CallTrackerRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const serialNumber = Number(row.getCell(1).value ?? 0);
    const mobileNumber = normalizeDigits(row.getCell(2).value);
    const nameRaw = String(row.getCell(3).value ?? "").trim();
    const callCount = Number(row.getCell(4).value ?? 0);
    const categoryRaw = String(row.getCell(5).value ?? "").trim();

    if (!mobileNumber) return;

    rows.push({
      serialNumber: serialNumber || rowNumber - 1,
      mobileNumber,
      name: nameRaw || "Unknown",
      callCount: Number.isFinite(callCount) ? callCount : 0,
      category: (CALL_TRACKER_CATEGORIES as readonly string[]).includes(categoryRaw)
        ? (categoryRaw as CallTrackerCategory)
        : "",
    });
  });

  // De-duplicate by mobile number (legacy sheets may contain duplicates).
  // Merge strategy:
  // - callCount: sum
  // - name: prefer first non-Unknown
  // - category: prefer first non-empty
  // - serial: lowest serial (stable)
  const byMobile = new Map<string, CallTrackerRow>();
  for (const r of rows) {
    const existing = byMobile.get(r.mobileNumber);
    if (!existing) {
      byMobile.set(r.mobileNumber, r);
      continue;
    }

    const existingHasName = Boolean(existing.name && existing.name !== "Unknown");
    const incomingHasName = Boolean(r.name && r.name !== "Unknown");
    const merged: CallTrackerRow = {
      serialNumber: Math.min(existing.serialNumber, r.serialNumber),
      mobileNumber: existing.mobileNumber,
      name: existingHasName ? existing.name : incomingHasName ? r.name : "Unknown",
      callCount: (Number(existing.callCount) || 0) + (Number(r.callCount) || 0),
      category: existing.category || r.category || "",
    };
    byMobile.set(r.mobileNumber, merged);
  }

  const deduped = Array.from(byMobile.values()).sort((a, b) => a.serialNumber - b.serialNumber);
  return deduped;
}

function writeRowsToWorksheet(ws: ExcelJS.Worksheet, rows: CallTrackerRow[]) {
  // Clear everything then re-add (keeps template simple/consistent).
  ws.spliceRows(2, ws.rowCount - 1);
  for (const r of rows) {
    ws.addRow([r.serialNumber, r.mobileNumber, r.name || "Unknown", r.callCount, r.category || ""]);
  }

  // Re-apply validation for actual used range (plus some extra).
  const start = 2;
  const end = Math.max(100, ws.rowCount + 200);
  for (let rr = start; rr <= end; rr++) {
    ws.getCell(`E${rr}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [categoryValidationFormula()],
      showErrorMessage: true,
      errorStyle: "error",
      errorTitle: "Invalid category",
      error: `Category must be one of: ${CALL_TRACKER_CATEGORIES.join(", ")}`,
    };
  }
}

export async function getAllCallTrackerRows(): Promise<CallTrackerRow[]> {
  const filePath = workbookPath();
  await createTemplateIfMissing(filePath);
  await normalizeWorkbookAtPath(filePath);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Calls") ?? wb.worksheets[0];
  if (!ws) return [];
  return worksheetToRows(ws);
}

export async function exportCallTrackerWorkbookBuffer(): Promise<Buffer> {
  const filePath = workbookPath();
  await createTemplateIfMissing(filePath);
  await normalizeWorkbookAtPath(filePath);
  return Buffer.from(await fs.readFile(filePath));
}

export async function importCallTrackerWorkbookBuffer(buf: ArrayBuffer) {
  const filePath = workbookPath();
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, Buffer.from(buf));
  await normalizeWorkbookAtPath(filePath);
}

export type CallTrackerSyncSummary = {
  mobileNumber: string;
  callCount: number;
  name?: string;
  category?: string;
};

export async function mergeCallTrackerFromSummaries(summaries: CallTrackerSyncSummary[]) {
  const filePath = workbookPath();
  await createTemplateIfMissing(filePath);
  await normalizeWorkbookAtPath(filePath);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Calls") ?? wb.worksheets[0];
  if (!ws) throw new Error("Missing worksheet");

  const rows = worksheetToRows(ws);
  const byMobile = new Map(rows.map((r) => [r.mobileNumber, r] as const));

  for (const s of summaries) {
    const mobile = normalizeDigits(s.mobileNumber);
    if (!mobile) continue;
    const existing = byMobile.get(mobile);
    const incomingName = String(s.name ?? "").trim();
    const hasIncomingName = Boolean(incomingName) && incomingName !== "Unknown";
    const incomingCategory = String(s.category ?? "").trim();
    const hasIncomingCategory = (CALL_TRACKER_CATEGORIES as readonly string[]).includes(incomingCategory);

    if (existing) {
      const shouldUpdateName = (!existing.name || existing.name === "Unknown") && hasIncomingName;
      const shouldUpdateCategory = !existing.category && hasIncomingCategory;
      byMobile.set(mobile, {
        ...existing,
        callCount: Math.max(existing.callCount, Number(s.callCount) || 0),
        name: shouldUpdateName ? incomingName : existing.name,
        category: shouldUpdateCategory ? (incomingCategory as CallTrackerCategory) : existing.category,
      });
    } else {
      const nextSerial =
        rows.length === 0 ? 1 : Math.max(0, ...Array.from(byMobile.values()).map((r) => r.serialNumber)) + 1;
      const newRow: CallTrackerRow = {
        serialNumber: nextSerial,
        mobileNumber: mobile,
        name: hasIncomingName ? incomingName : "Unknown",
        callCount: Number(s.callCount) || 0,
        category: hasIncomingCategory ? (incomingCategory as CallTrackerCategory) : "",
      };
      byMobile.set(mobile, newRow);
    }
  }

  const merged = Array.from(byMobile.values()).sort((a, b) => a.serialNumber - b.serialNumber);
  writeRowsToWorksheet(ws, merged);

  try {
    await wb.xlsx.writeFile(filePath);
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? "");
    if (msg.toLowerCase().includes("ebusy") || msg.toLowerCase().includes("used by another process")) {
      throw new Error(
        "The Excel file is currently open/locked by another program. Close call-tracker.xlsx and try again."
      );
    }
    throw e;
  }

  return merged;
}

export type LogCallResult = {
  row: CallTrackerRow;
  // What additional info the UI must ask for *after* logging this call.
  needs: "none" | "category" | "name_and_category";
};

export async function logCallAndMaybeUpdate(opts: {
  mobileNumber: string;
  name?: string;
  category?: string;
}): Promise<LogCallResult> {
  const filePath = workbookPath();
  await createTemplateIfMissing(filePath);

  const mobileNumber = normalizeDigits(opts.mobileNumber);
  if (!mobileNumber) {
    throw new Error("Mobile number is required");
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Calls") ?? wb.addWorksheet("Calls");
  if (ws.rowCount === 0) ws.addRow(headerRowValues());

  const rows = worksheetToRows(ws);
  const existingIdx = rows.findIndex((r) => r.mobileNumber === mobileNumber);

  let row: CallTrackerRow;
  if (existingIdx >= 0) {
    row = { ...rows[existingIdx], callCount: rows[existingIdx].callCount + 1 };
    rows[existingIdx] = row;
  } else {
    const nextSerial = rows.length === 0 ? 1 : Math.max(...rows.map((r) => r.serialNumber)) + 1;
    row = {
      serialNumber: nextSerial,
      mobileNumber,
      name: "Unknown",
      callCount: 1,
      category: "",
    };
    rows.push(row);
  }

  const hasKnownName = Boolean(row.name && row.name.trim() && row.name !== "Unknown");

  // Scenario A: Name available -> ask for category
  // Scenario B: Name unknown -> only ask when callCount >= 5
  let needs: LogCallResult["needs"] = "none";
  if (hasKnownName) {
    needs = "category";
  } else if (row.callCount >= 5) {
    needs = "name_and_category";
  }

  // Apply updates only when provided and allowed.
  const name = String(opts.name ?? "").trim();
  const category = String(opts.category ?? "").trim();
  const categoryOk = (CALL_TRACKER_CATEGORIES as readonly string[]).includes(category);

  if (needs === "category" && categoryOk) {
    row = { ...row, category: category as CallTrackerCategory };
    rows[rows.findIndex((r) => r.mobileNumber === mobileNumber)] = row;
    needs = "none";
  } else if (needs === "name_and_category") {
    const nameOk = Boolean(name);
    if (nameOk) {
      row = { ...row, name };
    }
    if (categoryOk) {
      row = { ...row, category: category as CallTrackerCategory };
    }

    rows[rows.findIndex((r) => r.mobileNumber === mobileNumber)] = row;

    if (Boolean(row.name && row.name !== "Unknown") && Boolean(row.category)) {
      needs = "none";
    }
  }

  // Persist
  rows.sort((a, b) => a.serialNumber - b.serialNumber);
  writeRowsToWorksheet(ws, rows);
  await ensureParentDir(filePath);
  try {
    await wb.xlsx.writeFile(filePath);
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? "");
    if (msg.toLowerCase().includes("ebusy") || msg.toLowerCase().includes("used by another process")) {
      throw new Error(
        "The Excel file is currently open/locked by another program. Close call-tracker.xlsx and try again."
      );
    }
    throw e;
  }

  return { row, needs };
}

