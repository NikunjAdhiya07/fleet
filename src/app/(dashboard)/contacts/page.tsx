import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import connectToDatabase from "@/lib/db";
import Contact from "@/models/Contact";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContactsTableClient, type ContactBankRow } from "./ContactsTableClient";

async function getContacts() {
  await connectToDatabase();
  // We can fetch all contacts for the admin view.
  // Sorting by employee name and then contact name.
  const contacts = await Contact.find().sort({ employeeName: 1, contactName: 1 }).lean();
  return contacts.map((c: any) => {
    const syncedAt =
      c.syncedAt instanceof Date ? c.syncedAt.toISOString() : c.syncedAt ? String(c.syncedAt) : null;
    const row: ContactBankRow = {
      id: String(c._id),
      employeeName: String(c.employeeName ?? ""),
      deviceId: String(c.deviceId ?? ""),
      contactName: String(c.contactName ?? ""),
      phoneNumber: String(c.phoneNumber ?? ""),
      syncedAt,
    };
    return row;
  });
}

export default async function ContactsPage() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role === "driver") {
    redirect("/login");
  }

  const contacts = await getContacts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-white">Contact Bank</h1>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-lg text-slate-200">Synced Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <div className="rounded-md border border-slate-800 bg-slate-900 px-4 py-10 text-center text-slate-500 text-sm">
              No contacts found. Have employees turn ON call monitoring to sync contacts.
            </div>
          ) : (
            <ContactsTableClient contacts={contacts} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
