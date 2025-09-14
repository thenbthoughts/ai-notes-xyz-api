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