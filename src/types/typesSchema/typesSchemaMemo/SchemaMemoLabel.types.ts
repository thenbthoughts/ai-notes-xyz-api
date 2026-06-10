import mongoose, { Document } from 'mongoose';

export interface IMemoLabel extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}
