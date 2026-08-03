import mongoose, { Schema } from 'mongoose';

import { IAgentUpdate } from '../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentUpdate.types';

const agentUpdateSchema = new Schema<IAgentUpdate>({
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
    updateType: {
        type: String,
        enum: [
            'status',
            'goal_started',
            'goal_completed',
            'goal_failed',
            'memory_written',
            'domain_search',
            'message',
            'error',
            'tick',
            'excel_created',
            'script_executed',
            'tool_result',
        ],
        default: 'status',
        index: true,
    },
    message: { type: String, default: '' },
    payload: { type: Schema.Types.Mixed, default: {} },
    goalId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        ref: 'agentGoal',
    },
    tickNumber: { type: Number, default: 0 },
    createdAtUtc: { type: Date, default: () => new Date(), index: true },
});

agentUpdateSchema.index({ agentInstanceId: 1, createdAtUtc: -1 });
agentUpdateSchema.index({ threadId: 1, createdAtUtc: -1 });

const ModelAgentUpdate = mongoose.model<IAgentUpdate>(
    'agentUpdate',
    agentUpdateSchema,
    'agentUpdate'
);

export { ModelAgentUpdate };
