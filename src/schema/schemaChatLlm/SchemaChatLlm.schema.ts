import mongoose, { Document, Schema } from 'mongoose';

import { IChatLlm } from '../../types/typesSchema/typesChatLlm/SchemaChatLlm.types';

const shellRunArtifactV1TodoSchema = new Schema(
    {
        orderIndex: { type: Number, required: true },
        taskName: { type: String, required: true },
        executeStrategyBy: { type: String, required: true },
        shellCommand: { type: String, default: '' },
        verifyShellCommand: { type: String, default: '' },
        attemptCount: { type: Number, default: 0 },
        status: { type: String, required: true },
        exitCode: { type: Number, default: null },
        verifyExitCode: { type: Number, default: null },
        stdoutPreview: { type: String, default: '' },
        stderrPreview: { type: String, default: '' },
    },
    { _id: false },
);

const shellRunArtifactV1ImportedFileSchema = new Schema(
    {
        fileName: { type: String, required: true },
        mimeType: { type: String, default: '' },
        storedFileUrl: { type: String, required: true },
        relativePath: { type: String, default: '' },
        summaryPreview: { type: String, default: '' },
    },
    { _id: false },
);

const shellRunArtifactV1Schema = new Schema(
    {
        version: { type: Number, required: true },
        kind: { type: String, required: true },
        chatShellRunGroupId: { type: mongoose.Schema.Types.ObjectId, required: true },
        threadId: { type: mongoose.Schema.Types.ObjectId, required: true },
        userId: { type: Schema.Types.ObjectId, ref: 'user', required: true },
        completedAtUtc: { type: Date, required: true },
        todos: { type: [shellRunArtifactV1TodoSchema], default: [] },
        importedFiles: { type: [shellRunArtifactV1ImportedFileSchema], default: [] },
    },
    { _id: false },
);

// Chat Schema
const chatLlmSchema = new Schema<IChatLlm>({
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    
    // 
    type: {
        type: String, required: true, default: ''
        // types are text, image, video, location, contacts, file etc.
    },
    content: { type: String, default: '' },
    reasoningContent: { type: String, default: '' },
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, index: true, },
    tags: { type: [String], default: [] },
    visibility: {
        type: String,
        default: '',
        // public or private
    },

    // file info
    fileUrl: {
        type: String,
        default: '',
    },
    fileContentText: {
        type: String,
        default: '',
    },
    fileContentAi: {
        type: String,
        default: '',
    },
    fileUrlArr: {
        type: [String],
        default: [],
    },

    shellRunArtifactV1: {
        type: shellRunArtifactV1Schema,
        required: false,
        default: undefined,
    },

    // 
    isAi: {
        type: Boolean,
        default: false,
    },
    aiModelName: {
        type: String,
        default: '',
    },
    aiModelProvider: {
        type: String,
        default: '',
    },

    // auto
    createdAtUtc: {
        type: Date,
        default: null,
    },
    createdAtIpAddress: {
        type: String,
        default: '',
    },
    createdAtUserAgent: {
        type: String,
        default: '',
    },
    updatedAtUtc: {
        type: Date,
        default: null,
    },
    updatedAtIpAddress: {
        type: String,
        default: '',
    },
    updatedAtUserAgent: {
        type: String,
        default: '',
    },

    // auto ai
    tagsAutoAi: { type: [String], default: [] },

    // stats
    promptTokens: {
        type: Number,
        default: 0,
    },
    completionTokens: {
        type: Number,
        default: 0,
    },
    reasoningTokens: {
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
});

// Chat Model
const ModelChatLlm = mongoose.model<IChatLlm>(
    'chatLlm',
    chatLlmSchema,
    'chatLlm'
);

export {
    ModelChatLlm
};