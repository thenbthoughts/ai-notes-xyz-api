import mongoose, { Schema } from 'mongoose';

import type { tsSchemaOllamaModelStoreModality } from '../../types/typesSchema/typesDynamicData/SchemaOllamaModelStoreModality.types';

// AI Model Schema
const aiModelStoreModalityOllamaSchema = new Schema<tsSchemaOllamaModelStoreModality>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true,
    },
    modelName: {
        type: String,
        default: '',
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

    contextLength: {
        type: Number,
        default: 0,
    },
    maxCompletionTokens: {
        type: Number,
        default: 0,
    },
});

// AI Model
const ModelAiModelStoreModalityOllama = mongoose.model<tsSchemaOllamaModelStoreModality>(
    'aiModelStoreModalityOllama',
    aiModelStoreModalityOllamaSchema,
    'aiModelStoreModalityOllama'
);

export {
    ModelAiModelStoreModalityOllama
};