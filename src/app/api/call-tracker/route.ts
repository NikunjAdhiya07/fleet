import { NextResponse } from "next/server";
import {
  CALL_TRACKER_CATEGORIES,
  getAllCallTrackerRows,
  logCallAndMaybeUpdate,
} from "@/lib/callTrackerExcel";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await getAllCallTrackerRows();
    return NextResponse.json({ rows, categories: CALL_TRACKER_CATEGORIES });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to load rows" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mobileNumber = body?.mobileNumber;
    const name = body?.name;
    const category = body?.category;

    const result = await logCallAndMaybeUpdate({ mobileNumber, name, category });
    const rows = await getAllCallTrackerRows();

    return NextResponse.json({
      row: result.row,
      needs: result.needs,
      rows,
      categories: CALL_TRACKER_CATEGORIES,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to log call" }, { status: 400 });
  }
}

