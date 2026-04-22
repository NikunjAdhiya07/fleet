import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import ExcelJS from "exceljs";

export const maxDuration = 30;

/**
 * GET /api/contact-intelligence/template
 *
 * Downloads an .xlsx template for bulk identified contacts import.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "CallLogs Dashboard";
  wb.created = new Date();
  const ws = wb.addWorksheet("Contacts Import");

  // Match your uploaded workbook style: a couple of intro rows + a header with Serial Number.
  ws.addRow(["Contacts Import Template", "", "", "", ""]);
  ws.addRow(["", "", "", "", ""]);
  ws.addRow(["", "", "", "", ""]);

  // Header row (same wording as your uploaded file)
  ws.addRow(["Serial Number", "Mobile Number", "Name (Current)", "Category", "Name (Enter here)"]);
  const headerRow = ws.getRow(4);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 18;
  ws.views = [{ state: "frozen", ySplit: 4 }];

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 26;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 26;

  ws.addRow([1, "919879333224", "", "staff", "Niravbhai"]);
  ws.addRow([2, "916353505518", "", "personal", "Appu"]);
  ws.addRow([3, "919999999999", "", "Existing Client", "Example Name"]);

  const buf = await wb.xlsx.writeBuffer(); // ArrayBuffer

  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="identified-contacts-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}

