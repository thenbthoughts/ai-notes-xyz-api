import mongoose, { Schema } from 'mongoose';

import { IAnswerMachineSubQuestionV4 } from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineSubQuestionV4.types';

const verificationVerdicts = ['retry_answer', 'needs_followup_question', 'ready_to_synthesize'];

const answerMachineSubQuestionV4Schema = new Schema<IAnswerMachineSubQuestionV4>({
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
    answerMachineRequestV4Id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'answerMachineRequestV4',
    },
    answerMachineIteration: { type: Number, required: true, index: true },
    username: { type: String, required: true, index: true },
    question: { type: String, default: '' },
    answerReasoningContent: { type: String, default: '' },
    answer: { type: String, default: '' },
    kind: {
        type: String,
        enum: ['opencode'],
        default: 'opencode',
        index: true,
    },
    status: {
        type: String,
        enum: ['pending', 'answered', 'skipped', 'error'],
        default: 'pending',
        index: true,
    },
    errorReason: { type: String, default: '' },
    stepIndex: { type: Number, index: true },
    attemptNumber: { type: Number, default: 1 },
    verificationVerdict: { type: String, enum: verificationVerdicts },
    verificationReason: { type: String, default: '' },
    verificationAllImpliedSubtasksDone: { type: Boolean },
    verificationFinalAnswerDeliverable: { type: Boolean },
    verificationGlobalTaskChecklist: { type: String, default: '' },
    contextFilesUsed: [{ type: String, default: '' }],
    aiModelName: { type: String, default: '' },
    aiModelProvider: { type: String, default: '' },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    reasoningTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    costInUsd: { type: Number, default: 0 },
    createdAtUtc: { type: Date, default: () => new Date() },
    updatedAtUtc: { type: Date, default: () => new Date() },
});

const ModelAnswerMachineSubQuestionV4 = mongoose.model<IAnswerMachineSubQuestionV4>(
    'answerMachineSubQuestionV4',
    answerMachineSubQuestionV4Schema,
    'answerMachineSubQuestionV4'
);

export { ModelAnswerMachineSubQuestionV4 };
