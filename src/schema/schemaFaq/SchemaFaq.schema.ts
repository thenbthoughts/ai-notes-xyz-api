import mongoose, { Schema } from 'mongoose';

import { IFaq } from '../../types/typesSchema/typesFaq/SchemaFaq.types';

// FAQ Schema
const faqSchema = new Schema<IFaq>({
    // identification
    username: { type: String, required: true, default: '', index: true },

    // fields
    question: { type: String, default: '', index: true },
    answer: { type: String, default: '' },
    aiCategory: { type: String, default: '', index: true },
    aiSubCategory: { type: String, default: '' },
    tags: { type: [String], default: [] },

    // source
    metadataSourceType: {
        type: String,
        default: '',
        enum: [
            'notes',
            'tasks',
            'chatLlm',
            'lifeEvents',
            'infoVault',
        ],
        index: true,
    },
    metadataSourceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },

    // has embedding
    hasEmbedding: { type: Boolean, default: false },
    vectorEmbeddingStr: { type: String, default: '' },

    // cron scheduling
    isActive: {
        type: Boolean,
        default: true,
    },
    cronExpressionArr: {
        type: [String],
        default: [],
    },
    scheduleExecutionTimeArr: {
        type: [Date],
        default: [],
    },
    scheduleExecutedTimeArr: {
        type: [Date],
        default: [],
    },
    executedTimes: {
        type: Number,
        default: 0,
    },
    timezoneName: {
        type: String,
        default: 'UTC',
    },
    timezoneOffset: {
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

// FAQ Model
const ModelFaq = mongoose.model<IFaq>(
    'aiFaq',
    faqSchema,
    'aiFaq'
);

export {
    ModelFaq
};

