import mongoose, { Schema } from 'mongoose';

import { IChatLlmAnswerMachine } from '../../../types/typesSchema/typesChatLlm/SchemaChatLlmAnswerMachine.types';

const chatLlmAnswerMachineSchema = new Schema<IChatLlmAnswerMachine>({
    // references
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

    // auth
    username: {
        type: String,
        required: true,
        index: true,
    },

    // status
    status: {
        type: String,
        enum: ['pending', 'answered', 'error'],
        default: 'pending',
        index: true,
    },
    errorReason: {
        type: String,
        default: '',
    },
    usedOpencode: {
        type: Boolean,
        default: false,
    },
    usedWebSearch: {
        type: Boolean,
        default: false,
    },

    // iteration tracking
    minNumberOfIterations: {
        type: Number,
        default: 1,
    },
    maxNumberOfIterations: {
        type: Number,
        default: 10,
    },
    currentIteration: {
        type: Number,
        default: 1,
    },

    // answers
    intermediateAnswers: [
        {
            type: String,
            default: '',
        }
    ],
    finalAnswer: {
        type: String,
        default: '',
    },
    isSatisfactoryFinalAnswer: {
        type: Boolean,
        default: false,
    },

    // token tracking - totals only (details in embedded tokenRecords)
    totalPromptTokens: {
        type: Number,
        default: 0,
    },
    totalCompletionTokens: {
        type: Number,
        default: 0,
    },
    totalReasoningTokens: {
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

    // timestamps
    createdAt: {
        type: Date,
        default: new Date(),
    },
    updatedAt: {
        type: Date,
        default: new Date(),
    },
});

const ModelChatLlmAnswerMachine = mongoose.model<IChatLlmAnswerMachine>(
    'chatLlmAnswerMachine',
    chatLlmAnswerMachineSchema,
    'chatLlmAnswerMachine'
);

export {
    ModelChatLlmAnswerMachine
};