import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();

  const [identifiedContacts, unknownTrackers, complianceIssues] = await Promise.all([
    // All identified contacts (have a name or category)
    IdentifiedContact.find({
      $or: [{ contactName: { $exists: true, $ne: "" } }, { category: { $exists: true } }],
    })
      .sort({ updatedAt: -1 })
      .lean(),

    // Unknown number trackers — show anything with 3+ calls
    UnknownNumberTracker.find({ callCount: { $gte: 3 } })
      .sort({ callCount: -1 })
      .lean(),

    // Compliance issues: identified contacts not yet saved in phone
    IdentifiedContact.find({
      contactName: { $exists: true, $ne: "" },
      category: { $exists: true },
      savedInPhone: false,
    })
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  return NextResponse.json({
    identifiedContacts,
    unknownTrackers,
    complianceIssues,
  });
}

// PATCH — manually update a contact's category or saved status
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, savedInPhone, category, remindLater } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await connectToDatabase();

  const update: any = {};
  if (savedInPhone !== undefined) update.savedInPhone = savedInPhone;
  if (category !== undefined) update.category = category;
  if (remindLater !== undefined) update.remindLater = remindLater;

  const result = await IdentifiedContact.findByIdAndUpdate(id, { $set: update }, { new: true });
  if (!result) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
