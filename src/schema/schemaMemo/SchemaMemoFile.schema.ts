import mongoose, { Schema } from 'mongoose';

import { IMemoFile } from '../../types/typesSchema/typesSchemaMemo/SchemaMemoFile.types';

const memoFileSchema = new Schema<IMemoFile>({
  username: { type: String, required: true, index: true },
  memoNoteId: { type: Schema.Types.ObjectId, ref: 'memoNotes', required: true, index: true },
  filePath: { type: String, required: true },
  sortOrder: { type: Number, default: 0 },
  createdAtUtc: { type: Date, default: () => new Date() },
});

memoFileSchema.index({ username: 1, memoNoteId: 1, sortOrder: 1 });
memoFileSchema.index({ username: 1, memoNoteId: 1, filePath: 1 }, { unique: true });

const ModelMemoFile = mongoose.model<IMemoFile>('memoFiles', memoFileSchema, 'memoFiles');

export { ModelMemoFile };
