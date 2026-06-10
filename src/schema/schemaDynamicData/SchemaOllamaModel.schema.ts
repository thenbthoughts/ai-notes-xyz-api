import mongoose, { Schema } from 'mongoose';

import type { tsSchemaAiModelListOllama } from '../../types/typesSchema/typesDynamicData/SchemaOllamaModel.types';

// AI Model Schema
const aiModelListOllamaSchema = new Schema<tsSchemaAiModelListOllama>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true,
    },
    modelLabel: {
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

    raw: {
        type: Object,
        default: {},
    },
});

// AI Model
const ModelAiListOllama = mongoose.model<tsSchemaAiModelListOllama>(
    'aiModelListOllama',
    aiModelListOllamaSchema,
    'aiModelListOllama'
);

export {
    ModelAiListOllama
};