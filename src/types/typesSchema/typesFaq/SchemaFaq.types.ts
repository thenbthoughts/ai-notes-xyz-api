import mongoose, { Document } from 'mongoose';

// FAQ
export interface IFaq extends Document {
    // identification
    username: string;

    // fields
    question: string;
    answer: string;
    aiCategory: string;
    aiSubCategory: string;
    tags: string[];
    
    // source
    metadataSourceType: string; // like notes, tasks, chatLlm, lifeEvents, infoVault etc.
    metadataSourceId: mongoose.Schema.Types.ObjectId | null;

    // has embedding
    hasEmbedding: boolean;
    vectorEmbeddingStr: string;

    // cron scheduling
    isActive: boolean;
    cronExpressionArr: string[];
    scheduleExecutionTimeArr: Date[];
    scheduleExecutedTimeArr: Date[];
    executedTimes: number;
    timezoneName: string;
    timezoneOffset: number;

    // auto
    createdAtUtc: Date | null;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date | null;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
};

