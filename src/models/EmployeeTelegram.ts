import mongoose, { Schema, Document } from 'mongoose';

export interface IEmployeeTelegram extends Document {
  employeeName: string;
  phoneNumber: string;       // employee's own phone number used for self-registration verification
  telegramChatId?: string;   // set when employee registers via /start
  registeredAt?: Date;       // when the employee linked their Telegram
}

const EmployeeTelegramSchema = new Schema(
  {
    employeeName: { type: String, required: true, unique: true },
    phoneNumber: { type: String, required: true, unique: true },
    telegramChatId: { type: String, default: null },
    registeredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.EmployeeTelegram ||
  mongoose.model<IEmployeeTelegram>('EmployeeTelegram', EmployeeTelegramSchema);
