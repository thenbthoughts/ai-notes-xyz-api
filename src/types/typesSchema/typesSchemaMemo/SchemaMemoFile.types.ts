import mongoose, { Document } from 'mongoose';

export interface IMemoFile extends Document {
  userId: mongoose.Types.ObjectId;
  memoNoteId: mongoose.Types.ObjectId;
  /** Uploaded storage path: `ai-notes-xyz/{userId}/features/...` */
  filePath: string;
  sortOrder: number;
  createdAtUtc: Date;
}
