import mongoose, { Schema } from 'mongoose';

import { IAnswerMachineRequestV4 } from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineRequestV4.types';

const answerMachineRequestV4Schema = new Schema<IAnswerMachineRequestV4>({
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
    username: {
        type: String,
        required: true,
        index: true,
    },
    schemaVersion: {
        type: Number,
        default: 4,
        index: true,
    },
    status: {
        type: String,
        enum: ['pending', 'answered', 'error'],
        default: 'pending',
        index: true,
    },
    errorReason: { type: String, default: '' },
    minNumberOfIterations: { type: Number, default: 1 },
    maxNumberOfIterations: { type: Number, default: 10 },
    currentIteration: { type: Number, default: 1 },
    intermediateAnswers: [{ type: String, default: '' }],
    finalAnswer: { type: String, default: '' },
    isSatisfactoryFinalAnswer: { type: Boolean, default: false },
    globalTaskDescription: { type: String, default: '' },
    attachedFiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'answerMachineFileV4' }],
    opencodeSessionId: { type: String, default: '', index: true },
    am4OpencodeExecutorModelKey: { type: String, default: '', index: false },
    totalPromptTokens: { type: Number, default: 0 },
    totalCompletionTokens: { type: Number, default: 0 },
    totalReasoningTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    costInUsd: { type: Number, default: 0 },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
});

const ModelAnswerMachineRequestV4 = mongoose.model<IAnswerMachineRequestV4>(
    'answerMachineRequestV4',
    answerMachineRequestV4Schema,
    'answerMachineRequestV4'
);

export { ModelAnswerMachineRequestV4 };
