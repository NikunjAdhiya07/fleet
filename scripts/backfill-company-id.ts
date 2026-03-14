import "dotenv/config";
import mongoose, { Schema } from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable inside .env.local");
}

// Minimal schema definitions to avoid Next.js model resolution issues in standalone script
const EmployeeTelegramSchema = new Schema({
  employeeName: { type: String, required: true },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
});

const DeviceCallLogSchema = new Schema({
  employeeName: { type: String },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
});

const CallLogSchema = new Schema({
  employeeName: { type: String },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
});

const EmployeeTelegram = mongoose.models.EmployeeTelegram || mongoose.model('EmployeeTelegram', EmployeeTelegramSchema);
const DeviceCallLog = mongoose.models.DeviceCallLog || mongoose.model('DeviceCallLog', DeviceCallLogSchema);
const CallLog = mongoose.models.CallLog || mongoose.model('CallLog', CallLogSchema);

async function backfill() {
  try {
    console.log("Starting backfill...");
    await mongoose.connect(MONGODB_URI!);
    console.log("Connected to MongoDB.");

    const employees = await EmployeeTelegram.find({ companyId: { $ne: null } });
    console.log(`Found ${employees.length} employees with companyId in EmployeeTelegram.`);

    for (const emp of employees) {
      console.log(`Backfilling for ${emp.employeeName} (Company: ${emp.companyId})...`);

      const deviceResult = await DeviceCallLog.updateMany(
        { employeeName: emp.employeeName, companyId: { $exists: false } },
        { $set: { companyId: emp.companyId } }
      );
      console.log(`Updated ${deviceResult.modifiedCount} DeviceCallLogs.`);

      const mainResult = await CallLog.updateMany(
        { employeeName: emp.employeeName, companyId: { $exists: false } },
        { $set: { companyId: emp.companyId } }
      );
      console.log(`Updated ${mainResult.modifiedCount} CallLogs.`);
    }

    // Special case: backfill mapping based on device logs if possible (optional, but good for completeness)
    
    console.log("Backfill completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exit(1);
  }
}

backfill();
