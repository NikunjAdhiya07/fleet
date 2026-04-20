import { NextResponse } from "next/server";
import { exportCallTrackerWorkbookBuffer } from "@/lib/callTrackerExcel";

export const runtime = "nodejs";

export async function GET() {
  try {
    const buf = await exportCallTrackerWorkbookBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="call-tracker.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Export failed" }, { status: 500 });
  }
}

