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
    isMemoryEnabled: {
        type: Boolean,
        default: false,
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

    // STT (Speech-to-Text)
    sttModelName: { type: String, default: '' },
    sttModelProvider: { type: String, default: '' },

    // TTS (Text-to-Speech)
    ttsModelName: { type: String, default: '' },
    ttsModelProvider: { type: String, default: '' },

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
        enum: ['conciseAnswer', 'agent'],
        default: 'conciseAnswer',
    },

    // answerEngine -> agent budgets
    agentMinBudgetTokens: {
        type: Number,
        default: 1,
    },
    agentMaxBudgetTokens: {
        type: Number,
        default: 1_000_000,
    },
    agentMinNumberOfIterations: {
        type: Number,
        default: 1,
    },
    agentMaxNumberOfIterations: {
        type: Number,
        default: 100,
    },
    agentContextActionLimit: {
        type: Number,
        default: 100,
    },
    agentContextSummaryCount: {
        type: Number,
        default: 10,
    },
    agentContextMessagesPerSummary: {
        type: Number,
        default: 10,
    },
    /** Per-call max tokens when generating execute_script source (not the run budget). */
    agentScriptMaxTokens: {
        type: Number,
        default: 8192,
    },

    /** When true, run shell prep before the next AI reply (concise stream or Agent) */
    executeShell: {
        type: Boolean,
        default: false,
    },
    shellExecuteMinAttempts: {
        type: Number,
        default: 1,
    },
    shellExecuteMaxAttempts: {
        type: Number,
        default: 1,
    },

    /** When true, allow omniparser-v2 via Replicate for GUI parsing (requires Replicate key) */
    useOmniparser: {
        type: Boolean,
        default: false,
    },

    // auth
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, index: true, },

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