import mongoose, { Document } from 'mongoose';

export interface IMemoFile extends Document {
  username: string;
  memoNoteId: mongoose.Types.ObjectId;
  /** Uploaded storage path: `ai-notes-xyz/{username}/features/...` */
  filePath: string;
  sortOrder: number;
  createdAtUtc: Date;
}
