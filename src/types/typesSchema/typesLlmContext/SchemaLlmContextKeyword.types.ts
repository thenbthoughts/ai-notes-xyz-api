import mongoose, { Document } from 'mongoose';

// LlmContextKeyword
export interface ILlmContextKeyword extends Document {
    // identification
    username: string;

    // fields
    keyword: string;
    aiCategory: string;
    aiSubCategory: string;
    aiTopic: string;
    aiSubTopic: string;
    
    // source
    metadataSourceType: string; // like notes, tasks, chatLlm, lifeEvents, infoVault etc.
    metadataSourceId: mongoose.Schema.Types.ObjectId | null;

    // has embedding
    hasEmbedding: boolean;
    vectorEmbeddingStr: string;
};