import mongoose, { Schema } from 'mongoose';

import { IAnswerMachineRequestV3 } from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineRequestV3.types';

const answerMachineRequestV3Schema = new Schema<IAnswerMachineRequestV3>({
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
        default: 3,
        index: true,
    },
    status: {
        type: String,
        enum: ['pending', 'answered', 'error'],
        default: 'pending',
        index: true,
    },
    errorReason: { type: String, default: '' },
    usedOpencode: { type: Boolean, default: false },
    usedWebSearch: { type: Boolean, default: false },
    minNumberOfIterations: { type: Number, default: 1 },
    maxNumberOfIterations: { type: Number, default: 10 },
    currentIteration: { type: Number, default: 1 },
    intermediateAnswers: [{ type: String, default: '' }],
    finalAnswer: { type: String, default: '' },
    isSatisfactoryFinalAnswer: { type: Boolean, default: false },
    totalPromptTokens: { type: Number, default: 0 },
    totalCompletionTokens: { type: Number, default: 0 },
    totalReasoningTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    costInUsd: { type: Number, default: 0 },
    /** User-facing objective for the whole AM3 run (frozen at initiate from the trigger message). */
    globalTaskDescription: { type: String, default: '' },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
});

const ModelAnswerMachineRequestV3 = mongoose.model<IAnswerMachineRequestV3>(
    'answerMachineRequestV3',
    answerMachineRequestV3Schema,
    'answerMachineRequestV3'
);

export { ModelAnswerMachineRequestV3 };
