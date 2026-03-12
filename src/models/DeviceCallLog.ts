import mongoose, { Schema, Document } from 'mongoose';

// Raw call logs submitted directly from Android devices.
// These use deviceId/employeeName instead of driverId/companyId.
export interface IDeviceCallLog extends Document {
  phoneNumber: string;
  contactName: string;
  callType: 'INCOMING' | 'OUTGOING' | 'MISSED';
  duration: number;
  timestamp: Date;
  deviceId: string;
  employeeName: string;
  syncedAt: Date;
}

const DeviceCallLogSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, trim: true },
    contactName: { type: String, default: 'Unknown' },
    callType: { type: String, enum: ['INCOMING', 'OUTGOING', 'MISSED'], required: true },
    duration: { type: Number, default: 0 },
    timestamp: { type: Date, required: true },
    deviceId: { type: String, required: true },
    employeeName: { type: String, default: 'Unknown' },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

DeviceCallLogSchema.index({ deviceId: 1, timestamp: -1 });
DeviceCallLogSchema.index({ employeeName: 1 });
DeviceCallLogSchema.index({ timestamp: -1 });
DeviceCallLogSchema.index(
  { deviceId: 1, phoneNumber: 1, timestamp: 1, duration: 1 },
  { unique: true }
);

export default mongoose.models.DeviceCallLog || mongoose.model<IDeviceCallLog>('DeviceCallLog', DeviceCallLogSchema);
