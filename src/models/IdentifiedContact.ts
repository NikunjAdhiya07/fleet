import mongoose, { Schema, Document } from 'mongoose';

export type ContactCategory = 'Family' | 'Colleague' | 'Existing Client' | 'New Client' | 'Other';

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
}

const IdentifiedContactSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, trim: true },
    employeeName: { type: String, required: true },
    deviceId: { type: String, default: '' },
    contactName: { type: String },
    category: {
      type: String,
      enum: ['Family', 'Colleague', 'Existing Client', 'New Client', 'Other'],
    },
    savedInPhone: { type: Boolean, default: false },
    remindLater: { type: Boolean, default: false },
    telegramChatId: { type: String },
    identifiedAt: { type: Date },
  },
  { timestamps: true }
);

// One record per (phone number, employee) pair
IdentifiedContactSchema.index({ phoneNumber: 1, employeeName: 1 }, { unique: true });
IdentifiedContactSchema.index({ employeeName: 1 });

export default mongoose.models.IdentifiedContact ||
  mongoose.model<IIdentifiedContact>('IdentifiedContact', IdentifiedContactSchema);
