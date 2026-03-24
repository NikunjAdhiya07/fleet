import mongoose, { Schema, Document } from 'mongoose';

export interface IToggleLog extends Document {
  deviceId: string;
  employeeName: string;
  status:
    | 'ON'
    | 'OFF'
    | 'PERMISSION_DENIED'
    | 'PERMISSION_RESTORED'
    | 'ADMIN_DISABLED'
    | 'ADMIN_ENABLED';
  reason?: string;
  timestamp: Date;
  createdAt: Date;
}

const ToggleLogSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    employeeName: { type: String, default: 'Unknown' },
    status: {
      type: String,
      enum: [
        'ON',
        'OFF',
        'PERMISSION_DENIED',
        'PERMISSION_RESTORED',
        'ADMIN_DISABLED',
        'ADMIN_ENABLED',
      ],
      required: true,
    },
    reason: { type: String },
    timestamp: { type: Date, required: true }
  },
  { timestamps: true }
);

export default mongoose.models.ToggleLog || mongoose.model<IToggleLog>('ToggleLog', ToggleLogSchema);
