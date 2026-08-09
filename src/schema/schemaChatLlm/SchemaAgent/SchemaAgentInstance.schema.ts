import mongoose, { Schema } from 'mongoose';

import { IAgentInstance } from '../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentInstance.types';

const agentInstanceSchema = new Schema<IAgentInstance>({
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
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: ['pending', 'success', 'failed'],
        default: 'pending',
        index: true,
    },
    statusIsRunning: {
        type: Boolean,
        default: false,
        index: true,
    },
    errorReason: { type: String, default: '' },
    tickCount: { type: Number, default: 0 },
    lastTickAtUtc: { type: Date, default: null },
    tickLockUntilUtc: { type: Date, default: null, index: true },
    cancellationRequestedUtc: { type: Date, default: null, index: true },
    summary: { type: String, default: '' },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    reasoningTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    costInUsd: { type: Number, default: 0 },
    maxPromptTokensPerQuery: { type: Number, default: 0 },
    maxCompletionTokensPerQuery: { type: Number, default: 0 },
    minBudgetTokens: { type: Number, default: 1 },
    maxBudgetTokens: { type: Number, default: 1_000_000 },
    minNumberOfIterations: { type: Number, default: 1 },
    maxNumberOfIterations: { type: Number, default: 100 },
    activeSkillNames: { type: [String], default: [] },
    createdAtUtc: { type: Date, default: () => new Date() },
    updatedAtUtc: { type: Date, default: () => new Date() },
});

agentInstanceSchema.index({ status: 1, tickLockUntilUtc: 1, _id: -1 });

const ModelAgentInstance = mongoose.model<IAgentInstance>(
    'agentInstance',
    agentInstanceSchema,
    'agentInstance'
);

export { ModelAgentInstance };
