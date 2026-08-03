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
        enum: ['running', 'paused', 'stopped', 'completed', 'error'],
        default: 'running',
        index: true,
    },
    errorReason: { type: String, default: '' },
    tickCount: { type: Number, default: 0 },
    lastTickAtUtc: { type: Date, default: null },
    tickLockUntilUtc: { type: Date, default: null, index: true },
    cancellationRequestedUtc: { type: Date, default: null, index: true },
    summary: { type: String, default: '' },
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
