import mongoose, { Schema, Document } from 'mongoose';

export type TrackerStatus = 'tracking' | 'awaiting_name' | 'awaiting_category' | 'identified';

export interface IUnknownNumberTracker extends Document {
  phoneNumber: string;
  employeeName: string;
  deviceId: string;
  callCount: number;
  firstSeen: Date;
  lastSeen: Date;
  telegramMessageId?: number;
  /** Set when a name-request Telegram was successfully sent — prevents duplicate sends. */
  nameRequestSentAt?: Date;
  status: TrackerStatus;
}

const UnknownNumberTrackerSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, trim: true },
    employeeName: { type: String, required: true },
    deviceId: { type: String, default: '' },
    callCount: { type: Number, default: 1 },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    telegramMessageId: { type: Number },
    nameRequestSentAt: { type: Date },
    status: {
      type: String,
      enum: ['tracking', 'awaiting_name', 'awaiting_category', 'identified'],
      default: 'tracking',
    },
  },
  { timestamps: true }
);

// One tracker per (phone number, employee) pair
UnknownNumberTrackerSchema.index({ phoneNumber: 1, employeeName: 1 }, { unique: true });
UnknownNumberTrackerSchema.index({ employeeName: 1 });
UnknownNumberTrackerSchema.index({ callCount: -1 });

export default mongoose.models.UnknownNumberTracker ||
  mongoose.model<IUnknownNumberTracker>('UnknownNumberTracker', UnknownNumberTrackerSchema);
