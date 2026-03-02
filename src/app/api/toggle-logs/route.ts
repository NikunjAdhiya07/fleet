import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import ToggleLog from "@/models/ToggleLog";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const deviceId = searchParams.get("deviceId");
    const status = searchParams.get("status");

    const query: any = {};
    if (deviceId) {
      query.deviceId = deviceId;
    }
    if (status && status !== "ALL") {
      query.status = status;
    }

    await connectToDatabase();
    
    const logs = await ToggleLog.find(query)
      .sort({ timestamp: -1 })
      .limit(200);

    return NextResponse.json(logs);
  } catch (error) {
    console.error("Failed to fetch toggle logs:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
