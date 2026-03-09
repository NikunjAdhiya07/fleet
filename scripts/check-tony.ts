import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const EmployeeTelegramSchema = new mongoose.Schema({ employeeName: String, telegramChatId: String, phoneNumber: String });
const EmployeeTelegram = mongoose.models.EmployeeTelegram || mongoose.model('EmployeeTelegram', EmployeeTelegramSchema);

const UnknownTrackerSchema = new mongoose.Schema({ phoneNumber: String, employeeName: String, status: String, callCount: Number });
const UnknownTracker = mongoose.models.UnknownNumberTracker || mongoose.model('UnknownNumberTracker', UnknownTrackerSchema);

const IdentifiedContactSchema = new mongoose.Schema({ phoneNumber: String, employeeName: String, contactName: String });
const IdentifiedContact = mongoose.models.IdentifiedContact || mongoose.model('IdentifiedContact', IdentifiedContactSchema);

const ContactSchema = new mongoose.Schema({ phoneNumber: String, employeeName: String });
const Contact = mongoose.models.Contact || mongoose.model('Contact', ContactSchema);

async function check() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const name = "matt murdock";
  const num = "9876543210";

  const emp = await EmployeeTelegram.findOne({ employeeName: name }).lean();
  const tracker = await UnknownTracker.findOne({ employeeName: name, phoneNumber: num }).lean();
  const phoneContact = await Contact.findOne({ phoneNumber: num }).lean();
  const identified = await IdentifiedContact.findOne({ employeeName: name, phoneNumber: num }).lean();

  const fs = require('fs');
  fs.writeFileSync('db-out-tony.json', JSON.stringify({ emp, tracker, phoneContact, identified }, null, 2));
  console.log("Wrote to db-out-tony.json");
  process.exit(0);
}
check();
