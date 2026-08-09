import mongoose, { Schema } from 'mongoose';

import { IAgentGoal } from '../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentGoal.types';

const agentGoalSchema = new Schema<IAgentGoal>({
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
    parentGoalId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true,
        ref: 'agentGoal',
    },
    orderIndex: { type: Number, default: 0, index: true },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'failed', 'skipped'],
        default: 'pending',
        index: true,
    },
    result: { type: String, default: '' },
    createdAtUtc: { type: Date, default: () => new Date() },
    updatedAtUtc: { type: Date, default: () => new Date() },
    completedAtUtc: { type: Date, default: null },
});

agentGoalSchema.index({ agentInstanceId: 1, orderIndex: 1 });
agentGoalSchema.index({ agentInstanceId: 1, status: 1 });
agentGoalSchema.index({ agentInstanceId: 1, parentGoalId: 1, orderIndex: 1 });

const ModelAgentGoal = mongoose.model<IAgentGoal>(
    'agentGoal',
    agentGoalSchema,
    'agentGoal'
);

export { ModelAgentGoal };
