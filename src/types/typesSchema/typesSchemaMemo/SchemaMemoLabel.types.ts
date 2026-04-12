import mongoose, { Document } from 'mongoose';

export interface IMemoLabel extends Document {
  username: string;
  name: string;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}
