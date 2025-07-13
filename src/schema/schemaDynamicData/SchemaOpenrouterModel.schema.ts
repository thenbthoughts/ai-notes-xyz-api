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