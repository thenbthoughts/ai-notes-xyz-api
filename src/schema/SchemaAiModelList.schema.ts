import mongoose, { Document, Schema } from 'mongoose';

import type { tsSchemaAiModelList } from '../types/typesSchema/SchemaAiModelList.types';

// AI Model Schema
const aiModelListSchema = new Schema<tsSchemaAiModelList>({
    modelName: {
        type: String,
        required: true,
        default: '',
    },
    modelType: {
        type: String,
        required: true,
        default: '',
    },
    provider: {
        type: String,
        required: true,
        default: '',
    },
});

// AI Model
const ModelAiList = mongoose.model<tsSchemaAiModelList>(
    'aiModelList',
    aiModelListSchema,
    'aiModelList'
);

export {
    ModelAiList
};