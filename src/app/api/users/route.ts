import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import Driver from "@/models/Driver";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

export async function GET(req: Request) {
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

    const users = await User.aggregate([
      { $match: query },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "departments",
          localField: "departmentId",
          foreignField: "_id",
          as: "department",
        },
      },
      { $addFields: { department: { $arrayElemAt: ["$department", 0] } } },
      {
        $lookup: {
          from: "drivers",
          localField: "_id",
          foreignField: "userId",
          as: "driverProfile"
        }
      },
      {
        $addFields: {
          driverProfile: { $arrayElemAt: ["$driverProfile", 0] }
        }
      },
      {
        $project: {
          passwordHash: 0,
        }
      }
    ]);
    
    // Map the shape to explicitly surface the wallet balance at the top level for the UI
    const usersWithWallet = users.map(u => ({
      ...u,
      walletBalance: u.driverProfile?.walletBalance || 0,
      driverId: u.driverProfile?._id || null, // Needed for the topup POST route
    }));

    return NextResponse.json(usersWithWallet);
  } catch (error) {
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
    const { name, email, username, password, role, departmentId } = body;

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await connectToDatabase();

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return NextResponse.json({ error: "Email already exists" }, { status: 400 });
    }

    if (username) {
      const existingUsername = await User.findOne({ username });
      if (existingUsername) {
        return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
      }
    }

    const companyId = session.user.role === "super_admin" ? body.companyId : session.user.companyId;

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name,
      email,
      username: username || undefined,
      passwordHash,
      role,
      companyId: new mongoose.Types.ObjectId(companyId),
      departmentId: departmentId ? new mongoose.Types.ObjectId(departmentId) : undefined,
    });

    // Automatically create Driver profile if role is driver
    if (role === "driver") {
      await Driver.create({
        userId: newUser._id,
        companyId: new mongoose.Types.ObjectId(companyId),
        walletBalance: 0,
        status: "active"
      });
    }

    const userObj = newUser.toObject();
    delete userObj.passwordHash;

    return NextResponse.json(userObj, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { _id, name, email, username, password, role, departmentId } = await req.json();

    if (!_id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    await connectToDatabase();

    const userToUpdate = await User.findById(_id);
    if (!userToUpdate) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Security enforcing tenant isolation boundaries
    if (session.user.role !== "super_admin" && userToUpdate.companyId?.toString() !== session.user.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check email collisions
    if (email && email !== userToUpdate.email) {
      const emailCollision = await User.findOne({ email });
      if (emailCollision) return NextResponse.json({ error: "Email is already taken" }, { status: 400 });
      userToUpdate.email = email;
    }

    // Check username collisions
    if (username !== undefined && username !== userToUpdate.username) {
      if (username) {
        const usernameCollision = await User.findOne({ username });
        if (usernameCollision) return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
        userToUpdate.username = username;
      } else {
        userToUpdate.username = undefined; // Allow clearing username
      }
    }

    if (name) userToUpdate.name = name;

    // Department assignment is optional; allow clearing with empty string / null
    if (departmentId !== undefined) {
      userToUpdate.departmentId = departmentId
        ? new mongoose.Types.ObjectId(departmentId)
        : undefined;
    }
    
    // Changing role might mean we need to spin up a Driver profile, or handle orphans
    if (role && role !== userToUpdate.role) {
      userToUpdate.role = role;
      if (role === 'driver') {
        const existingDriver = await Driver.findOne({ userId: userToUpdate._id });
        if (!existingDriver) {
           await Driver.create({
            userId: userToUpdate._id,
            companyId: userToUpdate.companyId,
            walletBalance: 0,
            status: "active"
          });
        }
      }
    }

    // Update password optionally
    if (password && password.trim() !== '') {
      userToUpdate.passwordHash = await bcrypt.hash(password, 10);
    }

    await userToUpdate.save();
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Failed to update user:", error);
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
    const id = searchParams.get('id');

    if (!id) {
       return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    await connectToDatabase();

    const userToDelete = await User.findById(id);
    if (!userToDelete) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (session.user.role !== "super_admin" && userToDelete.companyId?.toString() !== session.user.companyId) {
       return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // If deleting a driver, also clean up the driver profile
    if (userToDelete.role === 'driver') {
       await Driver.deleteOne({ userId: userToDelete._id });
       // Note: Expenses, WalletTransactions, and CallLogs associated with driver ID remain for historical audit logs
    }

    await User.deleteOne({ _id: userToDelete._id });
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Failed to delete user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
