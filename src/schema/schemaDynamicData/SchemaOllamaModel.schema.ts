import mongoose, { Schema } from 'mongoose';

import type { tsSchemaAiModelListOllama } from '../../types/typesSchema/typesDynamicData/SchemaOllamaModel.types';

// AI Model Schema
const aiModelListOllamaSchema = new Schema<tsSchemaAiModelListOllama>({
    username: {
        type: String,
        default: '',
    },
    modelLabel: {
        type: String,
        default: '',
    },
    modelName: {
        type: String,
        default: '',
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