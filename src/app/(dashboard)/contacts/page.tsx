import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import connectToDatabase from "@/lib/db";
import Contact from "@/models/Contact";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

async function getContacts() {
  await connectToDatabase();
  // We can fetch all contacts for the admin view.
  // Sorting by employee name and then contact name.
  const contacts = await Contact.find().sort({ employeeName: 1, contactName: 1 }).lean();
  return contacts;
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
          <div className="rounded-md border border-slate-800 bg-slate-900">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-slate-800/50">
                  <TableHead className="text-slate-400">Employee / Device</TableHead>
                  <TableHead className="text-slate-400">Contact Name</TableHead>
                  <TableHead className="text-slate-400">Phone Number</TableHead>
                  <TableHead className="text-slate-400">Last Synced</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.length === 0 ? (
                  <TableRow className="border-slate-800 hover:bg-slate-800/50">
                    <TableCell colSpan={4} className="h-24 text-center text-slate-500">
                      No contacts found. Have employees turn ON call monitoring to sync contacts.
                    </TableCell>
                  </TableRow>
                ) : (
                  contacts.map((contact: any) => (
                    <TableRow key={contact._id.toString()} className="border-slate-800 hover:bg-slate-800/50">
                      <TableCell className="font-medium text-slate-300">
                        {contact.employeeName}
                        <br />
                        <span className="text-xs text-slate-500 font-mono">{contact.deviceId}</span>
                      </TableCell>
                      <TableCell className="text-slate-300">{contact.contactName}</TableCell>
                      <TableCell className="text-slate-300 font-mono">{contact.phoneNumber}</TableCell>
                      <TableCell className="text-slate-400 text-sm">
                        {contact.syncedAt ? format(new Date(contact.syncedAt), "MMM d, yyyy HH:mm") : "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
