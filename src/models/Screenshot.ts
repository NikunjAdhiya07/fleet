import mongoose, { Schema, Document } from 'mongoose';

export interface IScreenshot extends Document {
  deviceId: string;
  employeeName: string;
  timestamp: Date;
  cdnUrl: string;
  fileSize: number;
  createdAt: Date;
}

const ScreenshotSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    employeeName: { type: String, default: 'Unknown' },
    timestamp: { type: Date, required: true },
    cdnUrl: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ScreenshotSchema.index({ deviceId: 1, timestamp: -1 });
ScreenshotSchema.index({ employeeName: 1, timestamp: -1 });
ScreenshotSchema.index({ timestamp: -1 });

export default mongoose.models.Screenshot ||
  mongoose.model<IScreenshot>('Screenshot', ScreenshotSchema);
