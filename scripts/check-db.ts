import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Create minimal schemas to check
const EmployeeTelegramSchema = new mongoose.Schema({ employeeName: String, telegramChatId: String, phoneNumber: String });
const EmployeeTelegram = mongoose.models.EmployeeTelegram || mongoose.model('EmployeeTelegram', EmployeeTelegramSchema);

const UnknownTrackerSchema = new mongoose.Schema({ phoneNumber: String, employeeName: String, status: String, callCount: Number });
const UnknownTracker = mongoose.models.UnknownNumberTracker || mongoose.model('UnknownNumberTracker', UnknownTrackerSchema);

const ContactSchema = new mongoose.Schema({ phoneNumber: String, employeeName: String });
const Contact = mongoose.models.Contact || mongoose.model('Contact', ContactSchema);

async function check() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to DB.");

  const name = "matt murdock";
  const num = "1234567890";

  const emp = await EmployeeTelegram.findOne({ employeeName: name }).lean();
  const tracker = await UnknownTracker.findOne({ employeeName: name, phoneNumber: num }).lean();
  const phoneContact = await Contact.findOne({ phoneNumber: num }).lean();

  const fs = require('fs');
  fs.writeFileSync('db-out.json', JSON.stringify({ emp, tracker, phoneContact }, null, 2));
  console.log("Wrote to db-out.json");
  process.exit(0);
}
check();
