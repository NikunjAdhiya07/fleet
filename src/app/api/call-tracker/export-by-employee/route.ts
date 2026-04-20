import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import ExcelJS from "exceljs";

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallLog from "@/models/CallLog";
import DeviceCallLog from "@/models/DeviceCallLog";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import IdentifiedContact from "@/models/IdentifiedContact";
import { CALL_TRACKER_CATEGORIES, getAllCallTrackerRows } from "@/lib/callTrackerExcel";

export const runtime = "nodejs";

function normDigits(v: unknown) {
  return String(v ?? "").replace(/\D+/g, "");
}

function categoryValidationFormula() {
  return `"${CALL_TRACKER_CATEGORIES.join(",")}"`;
}

function safeSheetName(v: string) {
  // Excel sheet name constraints: <= 31 chars, no : \ / ? * [ ]
  const cleaned = v.replace(/[:\\/?*\[\]]+/g, " ").replace(/\s+/g, " ").trim();
  const short = cleaned.slice(0, 31);
  return short || "Unknown";
}

function normalizeIdentifiedCategory(raw: unknown): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const lower = v.toLowerCase();
  if (lower === "personal") return "Personal";
  if (lower === "staff") return "Staff";
  if (lower === "courier") return "Courier";
  if (v === "Existing Client") return "Existing Client";
  if (v === "New Client") return "New Client";
  return "";
}

async function aggregateLatestIdentifiedByEmployeePhone(match: any) {
  const res = await IdentifiedContact.aggregate([
    { $match: match },
    { $sort: { updatedAt: -1, createdAt: -1 } },
    {
      $group: {
        _id: { employeeName: "$employeeName", phoneNumber: "$phoneNumber" },
        name: { $first: "$contactName" },
        category: { $first: "$category" },
      },
    },
  ]).exec();
  return res as Array<{ _id: { employeeName: string; phoneNumber: string }; name?: string; category?: string }>;
}

function allocUniqueSheetName(used: Set<string>, desired: string) {
  const base = safeSheetName(desired);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let i = 2; i < 1000; i++) {
    const suffix = ` ${i}`;
    const candidate = safeSheetName(`${base.slice(0, 31 - suffix.length)}${suffix}`);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = safeSheetName(`${base.slice(0, 28)}...`);
  used.add(fallback);
  return fallback;
}

async function buildCompanyScopedOrQuery(session: any) {
  if (session!.user.role === "super_admin") return undefined;

  const companyObjectId = session!.user.companyId
    ? new mongoose.Types.ObjectId(session!.user.companyId!)
    : null;

  const employeeMappings = await EmployeeTelegram.find().select("employeeName").lean();
  const employeeNames = employeeMappings
    .map((m: any) => m.employeeName)
    .filter((n: any) => typeof n === "string" && n.trim().length > 0);

  const or: any[] = [];
  if (companyObjectId) or.push({ companyId: companyObjectId });
  or.push({ companyId: { $exists: false } }, { companyId: null });
  if (employeeNames.length > 0) or.push({ employeeName: { $in: employeeNames } });
  return or;
}

async function aggregateEmployeePhoneCounts(model: any, match: any) {
  const res = await model
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: { employeeName: "$employeeName", phoneNumber: "$phoneNumber" },
          callCount: { $sum: 1 },
        },
      },
    ])
    .exec();
  return res as Array<{ _id: { employeeName?: string; phoneNumber: string }; callCount: number }>;
}

async function aggregateLatestNamesPerEmployeePhone(model: any, match: any) {
  const res = await model
    .aggregate([
      { $match: { ...match, contactName: { $exists: true, $ne: null, $nin: ["", "Unknown"] } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: { employeeName: "$employeeName", phoneNumber: "$phoneNumber" },
          name: { $first: "$contactName" },
        },
      },
    ])
    .exec();
  return res as Array<{ _id: { employeeName?: string; phoneNumber: string }; name: string }>;
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const ignoredEmployees: string[] = Array.isArray(body?.ignoredEmployees)
      ? body.ignoredEmployees.filter((v: any) => typeof v === "string" && v.trim().length > 0)
      : [];

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    await connectToDatabase();

    const baseMatch: any = {};
    const or = await buildCompanyScopedOrQuery(session);
    if (or && or.length > 0) baseMatch.$or = or;
    if (startDate || endDate) {
      baseMatch.timestamp = {};
      if (startDate) baseMatch.timestamp.$gte = new Date(startDate);
      if (endDate) baseMatch.timestamp.$lte = new Date(endDate);
    }
    if (ignoredEmployees.length > 0) {
      baseMatch.$and = [
        ...(Array.isArray(baseMatch.$and) ? baseMatch.$and : []),
        { employeeName: { $nin: ignoredEmployees } },
      ];
    }

    const [mainCounts, devCounts, mainNames, devNames] = await Promise.all([
      aggregateEmployeePhoneCounts(CallLog, baseMatch),
      aggregateEmployeePhoneCounts(DeviceCallLog, baseMatch),
      aggregateLatestNamesPerEmployeePhone(CallLog, baseMatch),
      aggregateLatestNamesPerEmployeePhone(DeviceCallLog, baseMatch),
    ]);

    const counts = new Map<string, number>();
    const names = new Map<string, string>();

    const key = (employeeName: unknown, phoneNumber: unknown) =>
      `${String(employeeName ?? "Unknown").trim() || "Unknown"}::${normDigits(phoneNumber)}`;

    for (const r of [...mainCounts, ...devCounts]) {
      const k = key(r._id.employeeName, r._id.phoneNumber);
      if (k.endsWith("::")) continue;
      counts.set(k, (counts.get(k) ?? 0) + (r.callCount ?? 0));
    }

    // Prefer main names first
    for (const r of mainNames) {
      const k = key(r._id.employeeName, r._id.phoneNumber);
      if (k.endsWith("::")) continue;
      if (r.name) names.set(k, String(r.name));
    }
    for (const r of devNames) {
      const k = key(r._id.employeeName, r._id.phoneNumber);
      if (k.endsWith("::")) continue;
      if (r.name && !names.get(k)) names.set(k, String(r.name));
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Calllogs";

    // Pull existing names/categories from the call-tracker workbook.
    const trackerRows = await getAllCallTrackerRows();
    const trackerByMobile = new Map(
      trackerRows.map((r) => [
        normDigits(r.mobileNumber),
        { name: String(r.name ?? "").trim(), category: String(r.category ?? "").trim() },
      ] as const)
    );

    // Pull per-(employee,phone) categories/names from IdentifiedContact (source of truth for categories today).
    const identifiedMatch: any = {};
    if (ignoredEmployees.length > 0) identifiedMatch.employeeName = { $nin: ignoredEmployees };
    const identified = await aggregateLatestIdentifiedByEmployeePhone(identifiedMatch);
    const identifiedByEmpPhone = new Map(
      identified.map((r) => [
        `${String(r._id.employeeName ?? "Unknown").trim() || "Unknown"}::${normDigits(r._id.phoneNumber)}`,
        { name: String(r.name ?? "").trim(), category: normalizeIdentifiedCategory(r.category) },
      ] as const)
    );

    const byEmployee = new Map<
      string,
      Array<{ mobileNumber: string; name: string; callCount: number; category: string }>
    >();

    for (const [k, callCount] of counts.entries()) {
      const [employeeName, mobile] = k.split("::");
      if (!mobile) continue;
      const list = byEmployee.get(employeeName) ?? [];
      const tracker = trackerByMobile.get(mobile);
      const trackerName = tracker?.name && tracker.name !== "Unknown" ? tracker.name : "";
      const trackerCategory = tracker?.category ?? "";
      const id = identifiedByEmpPhone.get(`${employeeName}::${mobile}`);
      const idName = id?.name && id.name !== "Unknown" ? id.name : "";
      const idCategory = id?.category ?? "";
      list.push({
        mobileNumber: mobile,
        name: idName || trackerName || names.get(k) || "Unknown",
        callCount,
        category: idCategory || trackerCategory,
      });
      byEmployee.set(employeeName, list);
    }

    const employees = Array.from(byEmployee.keys()).sort((a, b) => a.localeCompare(b));
    if (employees.length === 0) {
      const ws = wb.addWorksheet("No Data");
      ws.addRow(["No rows found for current filters."]);
    } else {
      const usedSheetNames = new Set<string>();
      for (const emp of employees) {
        const ws = wb.addWorksheet(allocUniqueSheetName(usedSheetNames, emp));
        ws.addRow([`Employee: ${emp}`]);
        ws.getRow(1).font = { bold: true };
        ws.mergeCells("A1:F1");
        ws.views = [{ state: "frozen", ySplit: 1 }];
        ws.columns = [
          { width: 14 },
          { width: 18 },
          { width: 24 },
          { width: 10 },
          { width: 18 },
          { width: 24 },
        ];

        const allRows = (byEmployee.get(emp) ?? []).sort((a, b) => b.callCount - a.callCount);
        const scenarioA = allRows.filter((r) => String(r.name ?? "").trim() && r.name !== "Unknown");
        // Scenario B should only include rows that have reached the threshold where we ask for name/category.
        const scenarioB = allRows.filter(
          (r) => (!String(r.name ?? "").trim() || r.name === "Unknown") && Number(r.callCount) >= 5
        );

        const addScenario = (title: string, rows: typeof allRows, opts?: { extraNameColumn?: boolean }) => {
          ws.addRow([]);
          ws.addRow([title]);
          ws.getRow(ws.rowCount).font = { bold: true };
          ws.mergeCells(`A${ws.rowCount}:F${ws.rowCount}`);
          ws.addRow(
            opts?.extraNameColumn
              ? ["Serial Number", "Mobile Number", "Name (Current)", "Call Count", "Category", "Name (Enter here)"]
              : ["Serial Number", "Mobile Number", "Name", "Call Count", "Category", ""]
          );
          ws.getRow(ws.rowCount).font = { bold: true };

          let serial = 1;
          for (const r of rows) {
            ws.addRow(
              opts?.extraNameColumn
                ? [serial++, r.mobileNumber, r.name || "Unknown", r.callCount, r.category || "", ""]
                : [serial++, r.mobileNumber, r.name || "Unknown", r.callCount, r.category || "", ""]
            );
          }
          if (rows.length === 0) {
            ws.addRow(["—", "—", "—", "—", "—", "—"]);
          }
        };

        addScenario("Scenario A — Name Available", scenarioA);
        addScenario("Scenario B — Name Unknown", scenarioB, { extraNameColumn: true });

        // Category validation
        const end = Math.max(100, ws.rowCount + 200);
        for (let rr = 2; rr <= end; rr++) {
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
    }

    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="call-tracker-by-employee.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Export failed" }, { status: 500 });
  }
}

