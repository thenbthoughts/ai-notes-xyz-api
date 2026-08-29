import mongoose, { Schema } from 'mongoose';

import type { tsSchemaAiModelListOpenrouter } from '../../types/typesSchema/typesDynamicData/SchemaOpenrouterModel.types';

// AI Model Schema
const aiModelListOpenrouterSchema = new Schema<tsSchemaAiModelListOpenrouter>({
    id: {
        type: String,
        default: '',
    },
    name: {
        type: String,
        default: '',
    },
    description: {
        type: String,
        default: '',
    },
    contextLength: {
        type: Number,
        default: 0,
    },
    maxCompletionTokens: {
        type: Number,
        default: 0,
    },

    raw: {
        type: Object,
        default: {},
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
});

// AI Model
const ModelAiListOpenrouter = mongoose.model<tsSchemaAiModelListOpenrouter>(
    'aiModelListOpenrouter',
    aiModelListOpenrouterSchema,
    'aiModelListOpenrouter'
);

export {
    ModelAiListOpenrouter
};