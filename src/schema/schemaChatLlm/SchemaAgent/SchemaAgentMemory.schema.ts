import mongoose, { Schema } from 'mongoose';

import { IAgentMemory } from '../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentMemory.types';

const agentMemorySchema = new Schema<IAgentMemory>({
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
    key: { type: String, default: '', index: true },
    content: { type: String, default: '' },
    memoryType: {
        type: String,
        enum: ['fact', 'observation', 'plan', 'result', 'other'],
        default: 'other',
    },
    past: { type: Boolean, default: false, index: true },
    createdAtUtc: { type: Date, default: () => new Date() },
    updatedAtUtc: { type: Date, default: () => new Date() },
});

agentMemorySchema.index({ agentInstanceId: 1, createdAtUtc: -1 });

const ModelAgentMemory = mongoose.model<IAgentMemory>(
    'agentMemory',
    agentMemorySchema,
    'agentMemory'
);

export { ModelAgentMemory };
