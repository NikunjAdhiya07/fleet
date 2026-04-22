import mongoose, { Schema, Document } from 'mongoose';

export type ContactCategory =
  | 'personal'
  | 'staff'
  | 'Existing Client'
  | 'New Client'
  | 'courier'
  | 'Family'
  | 'Colleague'
  | 'Other';

export interface IIdentifiedContact extends Document {
  phoneNumber: string;
  employeeName: string;
  deviceId: string;
  contactName?: string;
  category?: ContactCategory;
  savedInPhone: boolean;
  remindLater: boolean;
  telegramChatId?: string;
  identifiedAt?: Date;
  /** When we first sent the "classify this contact" Telegram message; no repeat until category is set. */
  categoryRequestSentAt?: Date;
  /** When we last sent a "confirm you've saved" reminder; used to avoid spam. */
  lastReminderSentAt?: Date;
}

const IdentifiedContactSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, trim: true },
    employeeName: { type: String, required: true },
    deviceId: { type: String, default: '' },
    contactName: { type: String },
    category: {
      type: String,
      // Keep as string but restrict to known UI categories used across the dashboard.
      enum: [
        'personal',
        'staff',
        'Existing Client',
        'New Client',
        'courier',
        'Family',
        'Colleague',
        'Other',
      ],
    },
    savedInPhone: { type: Boolean, default: false },
    remindLater: { type: Boolean, default: false },
    telegramChatId: { type: String },
    identifiedAt: { type: Date },
    categoryRequestSentAt: { type: Date },
    lastReminderSentAt: { type: Date },
  },
  { timestamps: true }
);

// One record per (phone number, employee) pair
IdentifiedContactSchema.index({ phoneNumber: 1, employeeName: 1 }, { unique: true });
IdentifiedContactSchema.index({ employeeName: 1 });

export default mongoose.models.IdentifiedContact ||
  mongoose.model<IIdentifiedContact>('IdentifiedContact', IdentifiedContactSchema);
