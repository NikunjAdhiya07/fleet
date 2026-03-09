import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallLog from "@/models/CallLog";
import Driver from "@/models/Driver";
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

    const query: any = {};
    if (session!.user.role !== "super_admin") {
      // Admins only see their company's logs AND any old legacy logs without a company assigned (for testing)
      query.$or = [
        { companyId: new mongoose.Types.ObjectId(session!.user.companyId!) },
        { companyId: { $exists: false } }
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

    await connectToDatabase();
    
    // Get the total unfiltered count first
    const totalCount = await CallLog.countDocuments(query);

    // Using populate to efficiently retrieve the driver's info through userId
    const logs = await CallLog.find(query)
      .populate({
        path: "driverId",
        select: "userId",
        populate: {
          path: "userId",
          select: "name email",
          model: "User"
        }
      })
      .sort({ timestamp: -1 });

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
      query.$or = [
        { companyId: new mongoose.Types.ObjectId(session.user.companyId!) },
        { companyId: { $exists: false } }
      ];
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
       query.$or = [
        { companyId: new mongoose.Types.ObjectId(session.user.companyId!) },
        { companyId: { $exists: false } }
      ];
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
