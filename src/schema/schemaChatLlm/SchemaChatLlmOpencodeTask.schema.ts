import mongoose, { Schema } from 'mongoose';

import {
    IChatLlmOpencodeTask,
    OpencodeTaskFileRef,
    OpencodeTaskStatus,
} from '../../types/typesSchema/typesChatLlm/SchemaChatLlmOpencodeTask.types';

const opencodeTaskFileRefSchema = new Schema<OpencodeTaskFileRef>(
    {
        fileName: { type: String, default: '' },
        filePath: { type: String, default: '' },
        contentType: { type: String, default: '' },
        size: { type: Number, default: 0 },
    },
    { _id: false }
);

const chatLlmOpencodeTaskSchema = new Schema<IChatLlmOpencodeTask>({
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    username: {
        type: String,
        required: true,
        index: true,
    },
    triggerMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true,
        ref: 'chatLlm',
    },
    answerMachineRecordId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true,
        ref: 'chatLlmAnswerMachine',
    },
    sortIndex: {
        type: Number,
        default: 0,
    },
    title: {
        type: String,
        default: '',
    },
    instruction: {
        type: String,
        default: '',
    },
    status: {
        type: String,
        enum: ['pending', 'running', 'done', 'error'] as OpencodeTaskStatus[],
        default: 'pending',
        index: true,
    },
    summary: {
        type: String,
        default: '',
    },
    errorReason: {
        type: String,
        default: '',
    },
    agentTranscript: {
        type: String,
        default: '',
    },
    inputFileRefs: {
        type: [opencodeTaskFileRefSchema],
        default: [],
    },
    outputFileRefs: {
        type: [opencodeTaskFileRefSchema],
        default: [],
    },
    runStartedAtUtc: {
        type: Date,
        default: null,
    },
    runFinishedAtUtc: {
        type: Date,
        default: null,
    },
    createdAtUtc: {
        type: Date,
        default: new Date(),
    },
    updatedAtUtc: {
        type: Date,
        default: new Date(),
    },
});

chatLlmOpencodeTaskSchema.index({ threadId: 1, username: 1, createdAtUtc: -1 });

const ModelChatLlmOpencodeTask = mongoose.model<IChatLlmOpencodeTask>(
    'chatLlmOpencodeTask',
    chatLlmOpencodeTaskSchema,
    'chatLlmOpencodeTask'
);

export { ModelChatLlmOpencodeTask };

