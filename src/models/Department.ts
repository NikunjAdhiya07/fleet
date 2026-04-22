import mongoose, { Schema, Document } from "mongoose";

export interface IDepartment extends Document {
  name: string;
  companyId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DepartmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
  },
  { timestamps: true }
);

// Uniqueness: department names should be unique within a company.
DepartmentSchema.index({ companyId: 1, name: 1 }, { unique: true });

export default mongoose.models.Department ||
  mongoose.model<IDepartment>("Department", DepartmentSchema);

