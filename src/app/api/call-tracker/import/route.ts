import { NextResponse } from "next/server";
import { importCallTrackerWorkbookBuffer, getAllCallTrackerRows, CALL_TRACKER_CATEGORIES } from "@/lib/callTrackerExcel";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const buf = await file.arrayBuffer();
    await importCallTrackerWorkbookBuffer(buf);

    const rows = await getAllCallTrackerRows();
    return NextResponse.json({ success: true, rows, categories: CALL_TRACKER_CATEGORIES });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Import failed" }, { status: 500 });
  }
}

