import mongoose, { Schema, Document } from "mongoose";

export interface IEmployeeDepartment extends Document {
  employeeName: string;
  departmentId: mongoose.Types.ObjectId;
  companyId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeDepartmentSchema = new Schema(
  {
    employeeName: { type: String, required: true, trim: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
  },
  { timestamps: true }
);

// One department assignment per employeeName per company.
EmployeeDepartmentSchema.index({ companyId: 1, employeeName: 1 }, { unique: true });

export default mongoose.models.EmployeeDepartment ||
  mongoose.model<IEmployeeDepartment>("EmployeeDepartment", EmployeeDepartmentSchema);

