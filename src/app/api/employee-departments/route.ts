import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import EmployeeDepartment from "@/models/EmployeeDepartment";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const query: any = {};
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }

    const rows = await EmployeeDepartment.find(query)
      .populate({ path: "departmentId", select: "name", model: "Department" })
      .sort({ employeeName: 1 })
      .lean();

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Failed to fetch employee departments:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// Upsert mapping (create or update) for an employeeName
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      employeeName?: string;
      departmentId?: string;
      companyId?: string; // super_admin only
    };

    const employeeName = String(body.employeeName ?? "").trim();
    const departmentId = String(body.departmentId ?? "").trim();
    if (!employeeName) return NextResponse.json({ error: "Employee name is required" }, { status: 400 });
    if (!departmentId) return NextResponse.json({ error: "Department is required" }, { status: 400 });

    await connectToDatabase();

    const companyId =
      session.user.role === "super_admin" ? body.companyId : session.user.companyId;
    if (!companyId) return NextResponse.json({ error: "Company is required" }, { status: 400 });

    const doc = await EmployeeDepartment.findOneAndUpdate(
      {
        companyId: new mongoose.Types.ObjectId(companyId),
        employeeName,
      },
      {
        $set: {
          departmentId: new mongoose.Types.ObjectId(departmentId),
        },
        $setOnInsert: {
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeName,
        },
      },
      { upsert: true, new: true }
    )
      .populate({ path: "departmentId", select: "name", model: "Department" })
      .lean();

    return NextResponse.json(doc, { status: 201 });
  } catch (error: any) {
    if (error?.code === 11000) {
      return NextResponse.json({ error: "Mapping already exists" }, { status: 400 });
    }
    console.error("Failed to upsert employee department:", error);
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
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    await connectToDatabase();

    const row = await EmployeeDepartment.findById(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (
      session.user.role !== "super_admin" &&
      row.companyId?.toString() !== session.user.companyId
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await EmployeeDepartment.deleteOne({ _id: row._id });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete employee department:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

