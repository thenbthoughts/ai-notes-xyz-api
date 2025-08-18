import mongoose, { Schema } from 'mongoose';

import { INotesFileUpload } from '../../types/typesSchema/typesSchemaNotes/SchemaNotesFileUpload.types';

// NotesFileUpload Schema
const notesFileUploadSchema = new Schema<INotesFileUpload>({
    // file fields
    fileType: {
        type: String,
        required: true,
        default: '',
        // fileType "image", "video", "audio" or "file"
    },
    fileUrl: { type: String, required: true, default: '' },
    fileTitle: { type: String, default: '' },
    fileDescription: { type: String, default: '' },

    // ai
    aiTitle: { type: String, default: '' },
    aiSummaryContext: { type: String, default: '' },
    aiSummarySpecific: { type: String, default: '' },
    aiTags: { type: [String], default: [] },

    // identification
    username: { type: String, required: true, default: '', index: true },
    noteId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// NotesFileUpload Model
const ModelNotesFileUpload = mongoose.model<INotesFileUpload>(
    'notesFileUpload',
    notesFileUploadSchema,
    'notesFileUpload'
);

export {
    ModelNotesFileUpload
};