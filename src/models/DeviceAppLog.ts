import mongoose, { Schema, Document } from "mongoose";

export interface IDeviceAppLog extends Document {
  deviceId: string;
  employeeName: string;
  message: string;
  /** Client-reported time when the line was logged on the phone */
  recordedAt: Date;
  companyId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const DeviceAppLogSchema = new Schema(
  {
    deviceId: { type: String, required: true, index: true },
    employeeName: { type: String, default: "Unknown" },
    message: { type: String, required: true, maxlength: 8000 },
    recordedAt: { type: Date, required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
  },
  { timestamps: true }
);

DeviceAppLogSchema.index({ createdAt: -1 });

export default mongoose.models.DeviceAppLog ||
  mongoose.model<IDeviceAppLog>("DeviceAppLog", DeviceAppLogSchema);
