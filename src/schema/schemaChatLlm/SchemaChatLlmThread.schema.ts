import mongoose, { Schema } from 'mongoose';

import { IChatLlmThread } from '../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types';

// Chat Schema
const chatLlmThreadSchema = new Schema<IChatLlmThread>({
    // fields
    threadTitle: {
        type: String, default: ''
    },
    isPersonalContextEnabled: {
        type: Boolean,
        default: true,
    },
    isAutoAiContextSelectEnabled: {
        type: Boolean,
        default: true,
    },
    systemPrompt: {
        type: String,
        default: ''
    },
    chatLlmTemperature: {
        type: Number,
        default: 1,
    },
    chatLlmMaxTokens: {
        type: Number,
        default: 8096,
    },
    chatMemoryLimit: {
        type: Number,
        default: 31,
    },

    // classification
    isFavourite: {
        type: Boolean,
        default: false,
    },

    // selected model
    aiModelName: {
        type: String,
        default: '',
        // model name
    },
    aiModelProvider: {
        type: String,
        default: '',
        // model provider like openrouter, groq, ollama, openai-compatible etc
    },
    aiModelOpenAiCompatibleConfigId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },

    // ai
    tagsAi: { type: [String], default: [] },
    aiSummary: {
        type: String,
        default: '',
    },
    aiTasks: [
        {
            type: String,
            default: ''
        }
    ],

    // answer engine
    answerEngine: {
        type: String,
        enum: ['conciseAnswer', 'answerMachine'],
        default: 'conciseAnswer',
    },

    // answerEngine -> answerMachine
    answerMachineMinNumberOfIterations: {
        type: Number,
        default: 1,
    },
    answerMachineMaxNumberOfIterations: {
        type: Number,
        default: 1,
    },
    answerMachineCurrentIteration: {
        type: Number,
        default: 0,
    },
    answerMachineStatus: {
        type: String,
        enum: ['not_started', 'pending', 'answered', 'error'],
        default: 'not_started',
    },
    answerMachineErrorReason: {
        type: String,
        default: '',
    },
    answerMachineUsedOpencode: {
        type: Boolean,
        default: false,
    },
    answerMachineUsedWebSearch: {
        type: Boolean,
        default: false,
    },
    answerMachineIntermediateAnswers: [
        {
            type: String,
            default: '',
        }
    ],

    // auth
    username: { type: String, required: true, default: '', index: true, },

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
});

// Chat Model
const ModelChatLlmThread = mongoose.model<IChatLlmThread>(
'chatLlmThread',
    chatLlmThreadSchema,
    'chatLlmThread'
);

export {
    ModelChatLlmThread
};