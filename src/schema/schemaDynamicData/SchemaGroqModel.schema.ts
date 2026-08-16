import mongoose, { Schema } from 'mongoose';

import type { tsSchemaAiModelListGroq } from '../../types/typesSchema/typesDynamicData/SchemaGroqModel.types';

// AI Model Schema
const aiModelListGroqSchema = new Schema<tsSchemaAiModelListGroq>({
    id: {
        type: String,
        default: '',
    },
    object: {
        type: String,
        default: '',
    },
    created: {
        type: Number,
        default: 0,
    },
    owned_by: {
        type: String,
        default: '',
    },
    active: {
        type: Boolean,
        default: false,
    },
    context_window: {
        type: Number,
        default: 0,
    },
    contextLength: {
        type: Number,
        default: 0,
    },
    maxCompletionTokens: {
        type: Number,
        default: 0,
    },

    // input modalities
    isInputModalityText: {
        type: String,
        default: 'pending',
        enum: ['true', 'false', 'pending'],
    },
    isInputModalityImage: {
        type: String,
        default: 'pending',
        enum: ['true', 'false', 'pending'],
    },
    isInputModalityAudio: {
        type: String,
        default: 'false',
        enum: ['true', 'false', 'pending'],
    },
    isInputModalityVideo: {
        type: String,
        default: 'false',
        enum: ['true', 'false', 'pending'],
    },

    // output modalities
    isOutputModalityText: {
        type: String,
        default: 'false',
        enum: ['true', 'false', 'pending'],
    },
    isOutputModalityImage: {
        type: String,
        default: 'false',
        enum: ['true', 'false', 'pending'],
    },
    isOutputModalityAudio: {
        type: String,
        default: 'false',
        enum: ['true', 'false', 'pending'],
    },
    isOutputModalityVideo: {
        type: String,
        default: 'false',
        enum: ['true', 'false', 'pending'],
    },
    isOutputModalityEmbedding: {
        type: String,
        default: 'false',
        enum: ['true', 'false', 'pending'],
    },

    raw: {
        type: Object,
        default: {},
    },
});

// AI Model
const ModelAiListGroq = mongoose.model<tsSchemaAiModelListGroq>(
    'aiModelListGroq',
    aiModelListGroqSchema,
    'aiModelListGroq'
);

export {
    ModelAiListGroq
};