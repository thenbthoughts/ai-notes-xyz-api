import mongoose, { Document } from 'mongoose';

export interface IMemoNote extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  body: string;
  labelIds: mongoose.Types.ObjectId[];
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  sortOrder: number;
  noteColor: string;
  createdAtUtc: Date;
  createdAtIpAddress: string;
  createdAtUserAgent: string;
  updatedAtUtc: Date;
  updatedAtIpAddress: string;
  updatedAtUserAgent: string;
}
