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