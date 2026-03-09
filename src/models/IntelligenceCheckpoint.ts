import mongoose, { Schema } from 'mongoose';

/**
 * Tracks the last time the contact intelligence processor ran.
 * This lets us only process *new* call logs instead of re-scanning all historic data every tick.
 */
const IntelligenceCheckpointSchema = new Schema(
  {
    key: { type: String, default: 'main', unique: true },
    lastProcessedAt: { type: Date, default: new Date(0) }, // epoch = process everything on first run
  },
  { timestamps: true }
);

export default mongoose.models.IntelligenceCheckpoint ||
  mongoose.model('IntelligenceCheckpoint', IntelligenceCheckpointSchema);
