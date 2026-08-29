import mongoose, { Schema } from 'mongoose';

import { IAgentFinal } from '../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentFinal.types';

const agentFinalSchema = new Schema<IAgentFinal>({
    chatMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlm',
        unique: true,
    },
    agentInstanceId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'agentInstance',
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true,
    },
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    goalId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        ref: 'agentGoal',
    },
    version: { type: Number, default: 1 },
    kind: { type: String, default: 'agent_final' },
    researchBrief: { type: String, default: '' },
    confidence: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'low',
    },
    createdAtUtc: { type: Date, default: () => new Date() },
    updatedAtUtc: { type: Date, default: () => new Date() },
});

agentFinalSchema.index({ threadId: 1, createdAtUtc: -1 });

const ModelAgentFinal = mongoose.model<IAgentFinal>(
    'agentFinal',
    agentFinalSchema,
    'agentFinal'
);

export { ModelAgentFinal };
