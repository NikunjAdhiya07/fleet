import mongoose, { Schema, Document } from 'mongoose';

export type BotLogLevel = 'info' | 'warn' | 'error' | 'success';

export interface IBotLog extends Document {
  level: BotLogLevel;
  step: string;
  message: string;
  data?: Record<string, any>;
  employeeName?: string;
  phoneNumber?: string;
  createdAt: Date;
}

const BotLogSchema = new Schema(
  {
    level: {
      type: String,
      enum: ['info', 'warn', 'error', 'success'],
      required: true,
    },
    step: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: null },
    employeeName: { type: String, default: null },
    phoneNumber: { type: String, default: null },
  },
  { timestamps: true }
);

BotLogSchema.index({ createdAt: -1 });
BotLogSchema.index({ employeeName: 1 });
BotLogSchema.index({ level: 1 });

export default mongoose.models.BotLog ||
  mongoose.model<IBotLog>('BotLog', BotLogSchema);
