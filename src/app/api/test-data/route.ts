import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import DeviceCallLog from "@/models/DeviceCallLog";
import CallLog from "@/models/CallLog";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();
    
    // Fetch unique employee names that have device logs
    const employeeNames = await DeviceCallLog.distinct("employeeName");

    // Also get employee names from processed call logs just in case
    const processedEmployeeNames = await CallLog.distinct("employeeName");
    
    // Combine and deduplicate
    const allNames = Array.from(new Set([...employeeNames, ...processedEmployeeNames])).filter(Boolean);
    
    allNames.sort();

    return NextResponse.json({ employees: allNames });
  } catch (error) {
    console.error("Failed to fetch employees:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employeeName } = await req.json();

    if (!employeeName) {
      return NextResponse.json({ error: "Employee name is required" }, { status: 400 });
    }

    await connectToDatabase();
    
    // Delete raw device logs
    const deviceResult = await DeviceCallLog.deleteMany({ employeeName });
    
    // Delete processed logs
    const processedResult = await CallLog.deleteMany({ employeeName });

    return NextResponse.json({ 
      success: true,
      message: `Deleted ${deviceResult.deletedCount} raw device logs and ${processedResult.deletedCount} processed call logs for ${employeeName}.` 
    });
  } catch (error) {
    console.error("Failed to delete employee data:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
