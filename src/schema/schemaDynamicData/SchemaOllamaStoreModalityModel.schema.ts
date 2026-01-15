import mongoose, { Schema } from 'mongoose';

import type { tsSchemaOllamaModelStoreModality } from '../../types/typesSchema/typesDynamicData/SchemaOllamaModelStoreModality.types';

// AI Model Schema
const aiModelStoreModalityOllamaSchema = new Schema<tsSchemaOllamaModelStoreModality>({
    username: {
        type: String,
        default: '',
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