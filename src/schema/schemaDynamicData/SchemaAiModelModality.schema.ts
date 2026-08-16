import mongoose, { Schema } from 'mongoose';

import type { tsSchemaAiModelModality } from '../../types/typesSchema/typesDynamicData/SchemaAiModelModality.types';

// AI Model Schema
const aiModelModalitySchema = new Schema<tsSchemaAiModelModality>({
    provider: {
        type: String,
        default: '',
        enum: ['openrouter', 'groq', 'ollama', 'custom'],
    },
    modalIdString: {
        type: String,
        default: '',
    },

    // input modalities
    isInputModalityText: {
        type: String,
        default: 'pending',
        enum: ['true', 'false', 'pending'],

        // true or false or pending
    },
    isInputModalityImage: {
        type: String,
        default: 'pending',
        enum: ['true', 'false', 'pending'],
        // true or false or pending
    },
    isInputModalityAudio: {
        type: String,
        default: 'pending',
        enum: ['true', 'false', 'pending'],
        // true or false or pending
    },
    isInputModalityVideo: {
        type: String,
        default: 'pending',
        enum: ['true', 'false', 'pending'],
        // true or false or pending
    },

    // output modalities
    isOutputModalityText: {
        type: String,
        default: 'pending',
        enum: ['true', 'false', 'pending'],
    },
    isOutputModalityImage: {
        type: String,
        default: 'pending',
        enum: ['true', 'false', 'pending'],
    },
    isOutputModalityAudio: {
        type: String,
        default: 'pending',
        enum: ['true', 'false', 'pending'],
    },
    isOutputModalityVideo: {
        type: String,
        default: 'pending',
        enum: ['true', 'false', 'pending'],
    },
    isOutputModalityEmbedding: {
        type: String,
        default: 'pending',
        enum: ['true', 'false', 'pending'],
    },

    contextLength: {
        type: Number,
        default: 0,
    },
    maxCompletionTokens: {
        type: Number,
        default: 0,
    },
});

// unique
aiModelModalitySchema.index(
    {
        provider: 1,
        modalIdString: 1,
    },
    {
        unique: true
    }
);

// AI Model
const ModelAiModelModality = mongoose.model<tsSchemaAiModelModality>(
    'aiModelModality',
    aiModelModalitySchema,
    'aiModelModality'
);

export {
    ModelAiModelModality
};