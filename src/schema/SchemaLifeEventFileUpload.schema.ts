import mongoose, { Schema } from 'mongoose';

import { ILifeEventsFileUpload } from '../types/typesSchema/SchemaLifeEventFileUpload.types';

// LifeEventsFileUpload Schema
const lifeEventsFileUploadSchema = new Schema<ILifeEventsFileUpload>({
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
    lifeEventId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// LifeEventsFileUpload Model
const ModelLifeEventsFileUpload = mongoose.model<ILifeEventsFileUpload>(
    'lifeEventsFileUpload',
    lifeEventsFileUploadSchema,
    'lifeEventsFileUpload'
);

export {
    ModelLifeEventsFileUpload
};