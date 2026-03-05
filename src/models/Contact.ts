import mongoose, { Schema, Document } from 'mongoose';

export interface IContact extends Document {
  deviceId: string;
  employeeName: string;
  contactName: string;
  phoneNumber: string;
  timestamp: Date;
  syncedAt: Date;
}

const ContactSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    employeeName: { type: String, default: 'Unknown' },
    contactName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    timestamp: { type: Date, required: true },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ContactSchema.index({ deviceId: 1, phoneNumber: 1 }, { unique: true });
ContactSchema.index({ employeeName: 1 });

export default mongoose.models.Contact || mongoose.model<IContact>('Contact', ContactSchema);
