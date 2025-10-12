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
        // model provider like openrouter, groq, ollama, jan etc
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