import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runContactIntelligence } from "@/lib/contactIntelligence";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role === "driver") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { phoneNumber, contactName, employeeName, deviceId } = body;

    if (!phoneNumber || !employeeName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Run the intelligence pipeline for this specific contact
    await runContactIntelligence(phoneNumber, contactName, employeeName, deviceId || "");

    return NextResponse.json({ success: true, message: "Intelligence triggered successfully" });
  } catch (error: any) {
    console.error("Manual send error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
