import mongoose, { Schema } from 'mongoose';

import { IAgentLog } from '../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentLog.types';

const agentLogSchema = new Schema<IAgentLog>({
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
    level: {
        type: String,
        enum: ['info', 'warn', 'error', 'debug'],
        default: 'info',
        index: true,
    },
    action: {
        type: String,
        default: 'other',
        index: true,
    },
    title: { type: String, default: '' },
    message: { type: String, default: '' },
    payload: { type: Schema.Types.Mixed, default: {} },
    raw: { type: Schema.Types.Mixed, default: null },
    goalId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        ref: 'agentGoal',
    },
    tickNumber: { type: Number, default: 0 },
    past: { type: Boolean, default: false, index: true },
    createdAtUtc: { type: Date, default: () => new Date(), index: true },
});

agentLogSchema.index({ agentInstanceId: 1, createdAtUtc: -1 });
agentLogSchema.index({ threadId: 1, createdAtUtc: -1 });
agentLogSchema.index({ agentInstanceId: 1, action: 1, createdAtUtc: -1 });

const ModelAgentLog = mongoose.model<IAgentLog>(
    'agentLog',
    agentLogSchema,
    'agentLog'
);

export { ModelAgentLog };
