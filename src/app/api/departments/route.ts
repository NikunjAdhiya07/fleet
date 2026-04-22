import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Department from "@/models/Department";

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

    const departments = await Department.find(query).sort({ name: 1 }).lean();
    return NextResponse.json(departments);
  } catch (error) {
    console.error("Failed to fetch departments:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name } = body as { name?: string };
    const trimmed = String(name ?? "").trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Department name is required" }, { status: 400 });
    }

    await connectToDatabase();

    const companyId =
      session.user.role === "super_admin" ? body.companyId : session.user.companyId;
    if (!companyId) {
      return NextResponse.json({ error: "Company is required" }, { status: 400 });
    }

    const created = await Department.create({
      name: trimmed,
      companyId: new mongoose.Types.ObjectId(companyId),
    });

    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (error: any) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: "Department name already exists" },
        { status: 400 }
      );
    }
    console.error("Failed to create department:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { _id, name } = body as { _id?: string; name?: string };
    const trimmed = String(name ?? "").trim();
    if (!_id) return NextResponse.json({ error: "Department ID is required" }, { status: 400 });
    if (!trimmed) return NextResponse.json({ error: "Department name is required" }, { status: 400 });

    await connectToDatabase();

    const department = await Department.findById(_id);
    if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });

    if (
      session.user.role !== "super_admin" &&
      department.companyId?.toString() !== session.user.companyId
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    department.name = trimmed;
    await department.save();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: "Department name already exists" },
        { status: 400 }
      );
    }
    console.error("Failed to update department:", error);
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
    if (!id) return NextResponse.json({ error: "Department ID is required" }, { status: 400 });

    await connectToDatabase();

    const department = await Department.findById(id);
    if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });

    if (
      session.user.role !== "super_admin" &&
      department.companyId?.toString() !== session.user.companyId
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await Department.deleteOne({ _id: department._id });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete department:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

