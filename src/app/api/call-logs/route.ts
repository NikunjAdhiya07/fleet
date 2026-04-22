import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallLog from "@/models/CallLog";
import DeviceCallLog from "@/models/DeviceCallLog";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import EmployeeDepartment from "@/models/EmployeeDepartment";
import mongoose from "mongoose";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const driverId = searchParams.get("driverId");
    const callType = searchParams.get("callType");
    const search = searchParams.get("search");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    await connectToDatabase();
    
    const query: any = {};
    if (session!.user.role !== "super_admin") {
      const companyObjectId = new mongoose.Types.ObjectId(session!.user.companyId!);
      const employeeMappings = await EmployeeTelegram.find()
        .select("employeeName")
        .lean();
      const employeeNames = employeeMappings
        .map((m: any) => m.employeeName)
        .filter((n: any) => typeof n === "string" && n.trim().length > 0);

      // Match logs that either:
      // 1. Have the admin's companyId set explicitly
      // 2. Were never stamped with a companyId (common for DeviceCallLog entries)
      // 3. Belong to an employee in the Telegram setup (any)
      query.$or = [
        { companyId: companyObjectId },
        { companyId: { $exists: false } },
        { companyId: null },
        ...(employeeNames.length > 0 ? [{ employeeName: { $in: employeeNames } }] : []),
      ];
    }

    if (driverId) {
      query.driverId = new mongoose.Types.ObjectId(driverId);
    }
    if (callType && callType !== "ALL") {
      query.callType = callType;
    }
    if (search) {
      query.phoneNumber = { $regex: search, $options: "i" };
    }
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    // Get the total unfiltered count first from both collections
    const [totalMainCount, totalDeviceCount] = await Promise.all([
      CallLog.countDocuments(query),
      DeviceCallLog.countDocuments(query)
    ]);
    const totalCount = totalMainCount + totalDeviceCount;

    // Fetch from both collections
    const [mainLogs, deviceLogs] = await Promise.all([
      CallLog.find(query)
        .populate({
          path: "driverId",
          select: "userId",
          populate: {
            path: "userId",
            select: "name email departmentId",
            model: "User",
            populate: {
              path: "departmentId",
              select: "name",
              model: "Department",
            },
          }
        })
        .lean(),
      DeviceCallLog.find(query).lean()
    ]);

    const merged = [...mainLogs, ...deviceLogs];

    // Attach department info for name-only employees via EmployeeDepartment mapping.
    // (Driver-backed logs already populate User.departmentId -> Department.)
    const employeeNames = Array.from(
      new Set(
        merged
          .map((l: any) => String(l?.employeeName ?? "").trim())
          .filter((n: string) => n.length > 0 && n.toLowerCase() !== "unknown")
      )
    );

    let mappingByName = new Map<string, { departmentName: string; departmentId: string }>();
    if (employeeNames.length > 0) {
      const mappingQuery: any = { employeeName: { $in: employeeNames } };
      if (session!.user.role !== "super_admin") {
        mappingQuery.companyId = new mongoose.Types.ObjectId(session!.user.companyId!);
      }
      const mappings = await EmployeeDepartment.find(mappingQuery)
        .populate({ path: "departmentId", select: "name", model: "Department" })
        .lean();
      mappingByName = new Map(
        (mappings as any[]).map((m) => [
          String(m.employeeName),
          {
            departmentName: String((m.departmentId as any)?.name ?? ""),
            departmentId: String((m.departmentId as any)?._id ?? ""),
          },
        ])
      );
    }

    const logs = merged
      .map((l: any) => {
        if (l?.employeeName) {
          const hit = mappingByName.get(String(l.employeeName).trim());
          if (hit?.departmentName) {
            return { ...l, employeeDepartment: hit };
          }
        }
        return l;
      })
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({ logs, totalCount });
  } catch (error) {
    console.error("Failed to fetch call logs:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await req.json();
    const { _id, employeeName, contactName, phoneNumber, callType, duration, timestamp } = data;

    if (!_id) {
      return NextResponse.json({ error: "Call log ID is required" }, { status: 400 });
    }

    await connectToDatabase();
    
    // Admins can only edit logs in their company
    const query: any = { _id: new mongoose.Types.ObjectId(_id) };
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }

    const updateData: any = {};
    if (employeeName !== undefined) updateData.employeeName = employeeName;
    if (contactName !== undefined) updateData.contactName = contactName;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (callType !== undefined) updateData.callType = callType;
    if (duration !== undefined) updateData.duration = duration;
    if (timestamp !== undefined) updateData.timestamp = new Date(timestamp);

    const log = await CallLog.findOneAndUpdate(query, updateData, { new: true });
    
    if (!log) {
      return NextResponse.json({ error: "Call log not found or unauthorized" }, { status: 404 });
    }

    return NextResponse.json(log);
  } catch (error) {
    console.error("Failed to update call log:", error);
    // Ignore duplicate key errors if index complains (rare but possible if editing to same thing as another record)
    if ((error as any).code === 11000) {
      return NextResponse.json({ error: " A log with these exact details already exists." }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Call log ID is required" }, { status: 400 });
    }

    await connectToDatabase();
    
    const query: any = { _id: new mongoose.Types.ObjectId(id) };
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }

    const result = await CallLog.deleteOne(query);

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Call log not found or unauthorized" }, { status: 404 });
    }

    return NextResponse.json({ message: "Call log deleted successfully" });
  } catch (error) {
    console.error("Failed to delete call log:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
