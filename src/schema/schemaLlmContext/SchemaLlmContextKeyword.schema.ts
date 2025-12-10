import mongoose, { Schema } from 'mongoose';

import { ILlmContextKeyword } from '../../types/typesSchema/typesLlmContext/SchemaLlmContextKeyword.types';

// LifeEvents Schema
const llmContextKeywordSchema = new Schema<ILlmContextKeyword>({
    // identification
    username: { type: String, required: true, default: '', index: true },

    // fields
    keyword: { type: String, default: '', index: true },
    aiCategory: { type: String, default: '', index: true },
    aiSubCategory: { type: String, default: '', index: true },
    aiTopic: { type: String, default: '', index: true },
    aiSubTopic: { type: String, default: '', index: true },

    // source
    metadataSourceType: {
        type: String,
        default: '',
        enum: [
            'notes',
            'tasks',
            'chatLlm',
            'lifeEvents',
            'infoVault',
        ],
    },
    metadataSourceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },

    // has embedding
    hasEmbedding: { type: Boolean, default: false },
    vectorEmbeddingStr: { type: String, default: '' },
});

// LlmContextKeyword Model
const ModelLlmContextKeyword = mongoose.model<ILlmContextKeyword>(
    'llmContextKeyword',
    llmContextKeywordSchema,
    'llmContextKeyword'
);

export {
    ModelLlmContextKeyword
};