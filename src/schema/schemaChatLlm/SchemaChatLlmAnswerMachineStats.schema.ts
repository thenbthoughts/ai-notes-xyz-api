import mongoose, { Schema } from 'mongoose';

import { IChatLlmAnswerMachineStats } from '../../types/typesSchema/typesChatLlm/SchemaChatLlmAnswerMachineStats.types';

const chatLlmAnswerMachineStatsSchema = new Schema<IChatLlmAnswerMachineStats>({
    // reference to the live record
    answerMachineId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmAnswerMachine',
    },

    // references
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    parentMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlm',
    },

    // auth
    username: {
        type: String,
        required: true,
        index: true,
    },

    // summary counts
    subQuestionsCount: {
        type: Number,
        default: 0,
    },
    intermediateAnswersCount: {
        type: Number,
        default: 0,
    },

    // final answer
    finalAnswer: {
        type: String,
        default: '',
    },

    // status
    status: {
        type: String,
        enum: ['answered', 'error'],
        required: true,
        index: true,
    },

    // token tracking (final aggregated totals)
    tokenBreakdown: {
        type: Map,
        of: {
            promptTokens: { type: Number, default: 0 },
            completionTokens: { type: Number, default: 0 },
            reasoningTokens: { type: Number, default: 0 },
            totalTokens: { type: Number, default: 0 },
            costInUsd: { type: Number, default: 0 },
            count: { type: Number, default: 0 },
            maxSingleQueryTokens: { type: Number, default: 0 },
        },
        default: {},
    },
    totalPromptTokens: {
        type: Number,
        default: 0,
    },
    totalCompletionTokens: {
        type: Number,
        default: 0,
    },
    totalReasoningTokens: {
        type: Number,
        default: 0,
    },
    totalTokens: {
        type: Number,
        default: 0,
    },
    costInUsd: {
        type: Number,
        default: 0,
    },

    // timestamp
    createdAtUtc: {
        type: Date,
        default: new Date(),
    },
});

const ModelChatLlmAnswerMachineStats = mongoose.model<IChatLlmAnswerMachineStats>(
    'chatLlmAnswerMachineStats',
    chatLlmAnswerMachineStatsSchema,
    'chatLlmAnswerMachineStats'
);

export {
    ModelChatLlmAnswerMachineStats
};