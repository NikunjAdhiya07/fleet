import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallLog from "@/models/CallLog";
import DeviceCallLog from "@/models/DeviceCallLog";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import EmployeeDepartment from "@/models/EmployeeDepartment";
// Imported for their side-effect of registering the mongoose model,
// which the populate() chain below relies on.
import "@/models/Driver";
import "@/models/User";
import "@/models/Department";
import mongoose from "mongoose";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const role = String(session?.user?.role ?? "").toLowerCase();
    const isSuperAdmin = role === "super_admin";
    if (!session?.user?.companyId && !isSuperAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const driverId = searchParams.get("driverId");
    const callType = searchParams.get("callType");
    const search = searchParams.get("search");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    await connectToDatabase();

    // Build the query as a flat set of independent clauses. We combine them
    // with $and at the end so multiple $or clauses (company scoping + date
    // range fallback) never overwrite each other.
    const clauses: Record<string, unknown>[] = [];

    if (!isSuperAdmin) {
      const companyObjectId = new mongoose.Types.ObjectId(session!.user.companyId!);

      // Scope the Telegram employee lookup to this company so we don't leak
      // names from other tenants into the query.
      const employeeMappings = await EmployeeTelegram.find({
        $or: [
          { companyId: companyObjectId },
          { companyId: { $exists: false } },
          { companyId: null },
        ],
      })
        .select("employeeName")
        .lean();
      const employeeNames = Array.from(
        new Set(
          (employeeMappings as Array<{ employeeName?: unknown }>)
            .map((m) => (typeof m.employeeName === "string" ? m.employeeName.trim() : ""))
            .filter((n) => n.length > 0)
        )
      );

      // Match logs that either:
      // 1. Have the admin's companyId set explicitly
      // 2. Were never stamped with a companyId (common for DeviceCallLog entries)
      // 3. Belong to an employee in this company's Telegram setup
      clauses.push({
        $or: [
          { companyId: companyObjectId },
          { companyId: { $exists: false } },
          { companyId: null },
          ...(employeeNames.length > 0 ? [{ employeeName: { $in: employeeNames } }] : []),
        ],
      });
    }

    if (driverId) {
      clauses.push({ driverId: new mongoose.Types.ObjectId(driverId) });
    }
    if (callType && callType !== "ALL") {
      const types = callType.split(",");
      clauses.push({ callType: { $in: types } });
    }
    if (search) {
      clauses.push({ phoneNumber: { $regex: search, $options: "i" } });
    }
    if (startDate || endDate) {
      const range: Record<string, Date> = {};
      if (startDate) range.$gte = new Date(startDate);
      if (endDate) range.$lte = new Date(endDate);

      // Match on `timestamp` first, then fall back to `syncedAt` / `createdAt`
      // for older rows whose device-supplied timestamp was wrong (e.g. unix
      // seconds saved as ms, or unset entirely).
      clauses.push({
        $or: [
          { timestamp: range },
          { syncedAt: range },
          { createdAt: range },
        ],
      });
    }

    const query: Record<string, unknown> =
      clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { $and: clauses };

    const [totalMainCount, totalDeviceCount, mainLogs, deviceLogs] = await Promise.all([
      CallLog.countDocuments(query),
      DeviceCallLog.countDocuments(query),
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
          },
        })
        .lean(),
      DeviceCallLog.find(query).lean(),
    ]);
    const totalCount = totalMainCount + totalDeviceCount;

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
      const mappingQuery: Record<string, unknown> = { employeeName: { $in: employeeNames } };
      if (!isSuperAdmin) {
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
      .sort(
        (a: any, b: any) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

    return NextResponse.json({ logs, totalCount });
  } catch (error) {
    console.error("Failed to fetch call logs:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = String(session.user.role ?? "").toLowerCase();
    const isSuperAdmin = role === "super_admin";
    if (!session?.user?.companyId && !isSuperAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = session.user;

    const data = await req.json();
    const { _id, employeeName, contactName, phoneNumber, callType, duration, timestamp } = data;

    if (!_id) {
      return NextResponse.json({ error: "Call log ID is required" }, { status: 400 });
    }

    await connectToDatabase();
    
    // Admins can only edit logs in their company
    const query: any = { _id: new mongoose.Types.ObjectId(_id) };
    if (!isSuperAdmin) {
      query.companyId = new mongoose.Types.ObjectId(user.companyId!);
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
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = String(session.user.role ?? "").toLowerCase();
    const isSuperAdmin = role === "super_admin";
    if (!session?.user?.companyId && !isSuperAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = session.user;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Call log ID is required" }, { status: 400 });
    }

    await connectToDatabase();
    
    const query: any = { _id: new mongoose.Types.ObjectId(id) };
    if (!isSuperAdmin) {
      query.companyId = new mongoose.Types.ObjectId(user.companyId!);
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
