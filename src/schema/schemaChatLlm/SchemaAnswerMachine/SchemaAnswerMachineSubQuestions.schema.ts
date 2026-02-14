import mongoose, { Schema, Document } from 'mongoose';

import { IAnswerMachineSubQuestion } from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineSubQuestions.types';

const answerMachineSubQuestionSchema = new Schema<IAnswerMachineSubQuestion>({
    // identification
    answerMachineId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmAnswerMachine',
    },
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

    // fields
    question: { type: String }, // The actual sub-question text
    answerReasoningContent: { type: String, default: '' }, // The reasoning content for the sub-question
    answer: { type: String }, // The answer to the sub-question
    contextIds: [{ type: mongoose.Schema.Types.ObjectId, default: [] }], // The context ids for the sub-question

    // status
    status: {
        type: String,
        enum: ['pending', 'answered', 'skipped', 'error'],
        default: 'pending',
        index: true,
    }, // Progress of answering the sub-question
    errorReason: {
        type: String,
        default: '',
    },

    // auth
    username: { type: String, index: true },

    // auto
    createdAtUtc: {
        type: Date,
        default: new Date(),
    },
    updatedAtUtc: {
        type: Date,
        default: new Date(),
    },

    // model info
    aiModelName: {
        type: String,
        default: '',
    },
    aiModelProvider: {
        type: String,
        default: '',
    },

    // Statistics and cost
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

const ModelAnswerMachineSubQuestion = mongoose.model<IAnswerMachineSubQuestion>(
    'answerMachineSubQuestion',
    answerMachineSubQuestionSchema,
    'answerMachineSubQuestion'
);

export {
    ModelAnswerMachineSubQuestion,
};