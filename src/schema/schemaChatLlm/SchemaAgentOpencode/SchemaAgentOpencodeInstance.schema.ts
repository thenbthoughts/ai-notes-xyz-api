import mongoose, { Schema } from 'mongoose';

import { IAgentOpencodeInstance } from '../../../types/typesSchema/typesChatLlm/typesAgentOpencode/SchemaAgentOpencodeInstance.types';

const agentOpencodeInstanceSchema = new Schema<IAgentOpencodeInstance>({
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
    chatMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
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
        enum: ['pending', 'filesInitialized', 'failed'],
        default: 'pending',
        index: true,
    },
    statusIsRunning: {
        type: Boolean,
        default: false,
        index: true,
    },
    errorReason: { type: String, default: '' },
    promptText: { type: String, default: '' },
    workspaceRootRelativePath: { type: String, default: '' },
    inputPromptRelativePath: { type: String, default: '' },
    outputPromptRelativePath: { type: String, default: '' },
    agentWorkspaceRelativePath: { type: String, default: '' },
    pipelineStep: {
        type: String,
        enum: ['input', 'settings', 'opencode', 'output', 'done', ''],
        default: '',
        index: true,
    },
    opencodeRunId: { type: String, default: '' },
    filesInitializedAtUtc: { type: Date, default: null },
    createdAtUtc: { type: Date, default: () => new Date() },
    updatedAtUtc: { type: Date, default: () => new Date() },
});

agentOpencodeInstanceSchema.index({ status: 1, statusIsRunning: 1, createdAtUtc: 1 });
agentOpencodeInstanceSchema.index({ threadId: 1, userId: 1, status: 1 });

const ModelAgentOpencodeInstance = mongoose.model<IAgentOpencodeInstance>(
    'agentOpencodeInstance',
    agentOpencodeInstanceSchema,
    'agentOpencodeInstance'
);

export { ModelAgentOpencodeInstance };
