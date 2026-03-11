import mongoose, { Schema } from 'mongoose';

import type { tsSchemaAiModelListLocalai } from '../../types/typesSchema/typesDynamicData/SchemaLocalaiModel.types';

// AI Model Schema
const aiModelListLocalaiSchema = new Schema<tsSchemaAiModelListLocalai>({
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
    modelType: {
        type: String,
        default: '',
        enum: ['', 'llm', 'stt', 'tts', 'embedding', 'image-generation'],
        // llm | stt | tts | embedding | image-generation | '' (empty = not specified)
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

    raw: {
        type: Object,
        default: {},
    },
});

// AI Model
const ModelAiListLocalai = mongoose.model<tsSchemaAiModelListLocalai>(
    'aiModelListLocalai',
    aiModelListLocalaiSchema,
    'aiModelListLocalai'
);

export {
    ModelAiListLocalai
};