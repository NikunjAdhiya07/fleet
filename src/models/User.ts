import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  username?: string;
  passwordHash: string;
  role: 'super_admin' | 'admin' | 'driver';
  companyId?: mongoose.Types.ObjectId;
  departmentId?: mongoose.Types.ObjectId;
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
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
