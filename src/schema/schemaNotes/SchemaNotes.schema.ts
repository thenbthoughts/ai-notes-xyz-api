import mongoose, { Schema } from 'mongoose';

import { INotes } from '../../types/typesSchema/typesSchemaNotes/SchemaNotes.types';

// Notes Schema
const notesSchema = new Schema<INotes>({
    // identification
    username: { type: String, required: true, default: '', index: true },
    notesWorkspaceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    // fields
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    isStar: { type: Boolean, default: false },
    tags: { type: [String], default: [] },

    // ai
    aiSummary: { type: String, default: '' },
    aiTags: { type: [String], default: [] },
    aiSuggestions: { type: String, default: '' },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// Notes Model
const ModelNotes = mongoose.model<INotes>(
    'notes',
    notesSchema,
    'notes'
);

export {
    ModelNotes
};