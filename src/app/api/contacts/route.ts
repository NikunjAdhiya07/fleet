import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Contact from "@/models/Contact";

// Raise the body size limit to 10 MB to handle large contact lists
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = process.env.API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { contacts } = body;

    if (!Array.isArray(contacts)) {
      return NextResponse.json(
        { error: "Expected an array of contacts" },
        { status: 400 }
      );
    }

    await connectToDatabase();

    // Use bulkWrite for efficient upserts
    const bulkOps = contacts.map((contact: any) => ({
      updateOne: {
        filter: { 
          deviceId: contact.deviceId, 
          phoneNumber: contact.phoneNumber 
        },
        update: { 
          $set: {
            employeeName: contact.employeeName || "Unknown",
            contactName: contact.contactName || "Unknown",
            timestamp: contact.timestamp ? new Date(Number(contact.timestamp)) : new Date(),
            syncedAt: new Date()
          } 
        },
        upsert: true
      }
    }));

    if (bulkOps.length > 0) {
      await Contact.bulkWrite(bulkOps);
    }

    console.log(`🔌 Synced ${contacts.length} contacts`);
    return NextResponse.json({ success: true, count: contacts.length }, { status: 201 });
  } catch (error) {
    console.error("Failed to sync contacts:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
