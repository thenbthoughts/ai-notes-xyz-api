import mongoose, { Schema } from 'mongoose';

import { IMemoNote } from '../../types/typesSchema/typesSchemaMemo/SchemaMemoNote.types';

const memoNoteSchema = new Schema<IMemoNote>({
  username: { type: String, required: true, default: '', index: true },
  title: { type: String, default: '' },
  body: { type: String, default: '' },
  labelIds: [{ type: Schema.Types.ObjectId, ref: 'memoLabels' }],
  pinned: { type: Boolean, default: false },
  archived: { type: Boolean, default: false },
  trashed: { type: Boolean, default: false },
  /** Keep-style palette key: '', coral, orange, yellow, green, teal, blue, purple, pink, brown, gray */
  noteColor: { type: String, default: '' },
  createdAtUtc: { type: Date, default: null },
  createdAtIpAddress: { type: String, default: '' },
  createdAtUserAgent: { type: String, default: '' },
  updatedAtUtc: { type: Date, default: null },
  updatedAtIpAddress: { type: String, default: '' },
  updatedAtUserAgent: { type: String, default: '' },
});

memoNoteSchema.index({ username: 1, labelIds: 1 });

const ModelMemoNote = mongoose.model<IMemoNote>('memoNotes', memoNoteSchema, 'memoNotes');

export { ModelMemoNote };
