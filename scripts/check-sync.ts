import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const CallLogSchema = new mongoose.Schema({ phoneNumber: String, employeeName: String, timestamp: Date }, { strict: false });
const CallLog = mongoose.models.CallLog || mongoose.model('CallLog', CallLogSchema, 'calllogs');

const DeviceCallLogSchema = new mongoose.Schema({ phoneNumber: String, employeeName: String, timestamp: Date }, { strict: false });
const DeviceCallLog = mongoose.models.DeviceCallLog || mongoose.model('DeviceCallLog', DeviceCallLogSchema, 'devicecalllogs');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to DB");

  const latestCallLog = await CallLog.findOne().sort({ timestamp: -1 }).lean();
  const latestDeviceLog = await DeviceCallLog.findOne().sort({ timestamp: -1 }).lean();
  
  const fs = require('fs');
  fs.writeFileSync('db-sync-out.json', JSON.stringify({ 
    latestCallLog,
    latestDeviceLog
  }, null, 2));
  console.log("Wrote to db-sync-out.json");
  process.exit(0);
}
check();
