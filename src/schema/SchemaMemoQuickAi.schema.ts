import mongoose, { Schema } from 'mongoose';

import {
    tsMemoQuickAi
} from '../types/typesSchema/SchemaMemoQuickAi.types';

// Memo Schema
const memoSchema = new Schema<tsMemoQuickAi>({
    // username
    username: {
        type: String,
        default: '',
        required: true,
        trim: true,
        lowercase: true,
    },

    // Memo specific fields
    title: {
        type: String,
        default: '',
    },
    content: {
        type: String,
        default: '',
    },
    color: {
        type: String,
        default: '',
    },
    labels: {
        type: [String],
        default: [],
    },
    labelsAi: {
        type: [String],
        default: [],
    },
    isPinned: {
        type: Boolean,
        default: false,
    },
    shouldSentToAI: {
        type: Boolean,
        default: false,
        // This record will not send to AI if true.
    },
    position: {
        type: Number,
        default: 0,
    },

    // auto
    createdAtUtc: {
        type: Date,
        default: null,
    },
    createdAtIpAddress: {
        type: String,
        default: '',
    },
    createdAtUserAgent: {
        type: String,
        default: '',
    },
    updatedAtUtc: {
        type: Date,
        default: null,
    },
    updatedAtIpAddress: {
        type: String,
        default: '',
    },
    updatedAtUserAgent: {
        type: String,
        default: '',
    },
});

// ModelMemo
const ModelMemo = mongoose.model<tsMemoQuickAi>(
    'memo',
    memoSchema,
    'memo'
);

export {
    ModelMemo
};