import mongoose, { Schema } from 'mongoose';

import { IMemoLabel } from '../../types/typesSchema/typesSchemaMemo/SchemaMemoLabel.types';

const memoLabelSchema = new Schema<IMemoLabel>({
  userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, index: true },
  name: { type: String, required: true, default: '', trim: true },
  createdAtUtc: { type: Date, default: null },
  updatedAtUtc: { type: Date, default: null },
});

memoLabelSchema.index({ userId: 1, name: 1 }, { unique: true });

const ModelMemoLabel = mongoose.model<IMemoLabel>('memoLabels', memoLabelSchema, 'memoLabels');

export { ModelMemoLabel };
