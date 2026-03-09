import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const UnknownTrackerSchema = new mongoose.Schema({ phoneNumber: String, employeeName: String });
const UnknownTracker = mongoose.models.UnknownNumberTracker || mongoose.model('UnknownNumberTracker', UnknownTrackerSchema);

const IdentifiedContactSchema = new mongoose.Schema({ phoneNumber: String, employeeName: String });
const IdentifiedContact = mongoose.models.IdentifiedContact || mongoose.model('IdentifiedContact', IdentifiedContactSchema);

const DeviceCallLogSchema = new mongoose.Schema({ phoneNumber: String, employeeName: String });
const DeviceCallLog = mongoose.models.DeviceCallLog || mongoose.model('DeviceCallLog', DeviceCallLogSchema);

async function clean() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected. Deleting Peter Parker...");

  const num = "1234567890";
  const name = "matt murdock";

  const res1 = await UnknownTracker.deleteMany({ phoneNumber: num, employeeName: name });
  const res2 = await IdentifiedContact.deleteMany({ phoneNumber: num, employeeName: name });
  const res3 = await DeviceCallLog.deleteMany({ phoneNumber: num, employeeName: name });

  console.log("Cleaned test data:", {
    unknown: res1.deletedCount,
    identified: res2.deletedCount,
    callLogs: res3.deletedCount
  });
  process.exit(0);
}
clean();
