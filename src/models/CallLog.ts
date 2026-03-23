import mongoose, { Schema, Document } from 'mongoose';

export interface ICallLog extends Document {
  driverId: mongoose.Types.ObjectId;
  phoneNumber: string;
  callType: 'INCOMING' | 'OUTGOING' | 'MISSED' | 'UNKNOWN';
  duration: number;
  timestamp: Date;
  syncedAt: Date;
  companyId: mongoose.Types.ObjectId;
  employeeName?: string;
  contactName?: string;
}

const CallLogSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    phoneNumber: { type: String, required: true },
    callType: { type: String, enum: ['INCOMING', 'OUTGOING', 'MISSED', 'UNKNOWN'], required: true },
    duration: { type: Number, required: true },
    timestamp: { type: Date, required: true },
    syncedAt: { type: Date, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    employeeName: { type: String },
    contactName: { type: String },
  },
  { timestamps: true }
);

// Compound index to prevent duplicates
CallLogSchema.index({ phoneNumber: 1, timestamp: 1, duration: 1 }, { unique: true });

export default mongoose.models.CallLog || mongoose.model<ICallLog>('CallLog', CallLogSchema);
