import mongoose, { Schema, Document } from 'mongoose';

/**
 * What a device may do once this user signs in on it. Previously carried by each
 * single-use EnrollmentCode; moved onto the user so a driver can re-authenticate
 * on a new or wiped handset without an admin minting a fresh code.
 */
export interface IUserCapabilities {
  callMonitoring: boolean;
  locationTracking: boolean;
  expenseManagement: boolean;
}

export interface IUser extends Document {
  name: string;
  email: string;
  username?: string;
  passwordHash: string;
  role: 'super_admin' | 'admin' | 'driver';
  companyId?: mongoose.Types.ObjectId;
  departmentId?: mongoose.Types.ObjectId;
  capabilities: IUserCapabilities;
  createdAt: Date;
}

const UserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    username: { type: String, unique: true, sparse: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['super_admin', 'admin', 'driver'], required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    // Defaults fail closed: a user record created before this field existed, or
    // by a code path that forgets it, must not silently enable tracking.
    capabilities: {
      callMonitoring: { type: Boolean, default: false },
      locationTracking: { type: Boolean, default: false },
      expenseManagement: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
