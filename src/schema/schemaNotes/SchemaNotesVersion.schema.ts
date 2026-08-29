import mongoose, { Schema } from 'mongoose';

export interface INotesVersion extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    noteId: mongoose.Types.ObjectId;
    title: string;
    description: string;
    tags: string[];
    folder: string;
    createdAtUtc: Date;
}

const notesVersionSchema = new Schema<INotesVersion>({
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, index: true },
    noteId: { type: Schema.Types.ObjectId, ref: 'notes', required: true, index: true },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    tags: { type: [String], default: [] },
    folder: { type: String, default: '' },
    createdAtUtc: { type: Date, default: () => new Date() },
});

notesVersionSchema.index({ noteId: 1, createdAtUtc: -1 });

const ModelNotesVersion = mongoose.model<INotesVersion>('notesVersion', notesVersionSchema, 'notesVersion');

export { ModelNotesVersion };
