import mongoose, { Schema } from 'mongoose';

import { IAgentCitation } from '../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentCitation.types';

const agentCitationSchema = new Schema<IAgentCitation>({
    agentFinalId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'agentFinal',
    },
    chatMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlm',
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
    source: { type: String, required: true, default: '' },
    sourceRecordId: { type: String, required: true, default: '' },
    title: { type: String, default: '' },
    summary: { type: String, default: '' },
    orderIndex: { type: Number, default: 0 },
    createdAtUtc: { type: Date, default: () => new Date() },
    updatedAtUtc: { type: Date, default: () => new Date() },
});

agentCitationSchema.index({ agentFinalId: 1, orderIndex: 1 });
agentCitationSchema.index(
    { agentFinalId: 1, source: 1, sourceRecordId: 1 },
    { unique: true }
);

const ModelAgentCitation = mongoose.model<IAgentCitation>(
    'agentCitation',
    agentCitationSchema,
    'agentCitation'
);

export { ModelAgentCitation };
