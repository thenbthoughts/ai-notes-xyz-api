import mongoose, { Document, Schema } from 'mongoose';

import { IChatLlm } from '../../types/typesSchema/typesChatLlm/SchemaChatLlm.types';

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
    content: { type: String, required: true, default: '' },
    username: { type: String, required: true, default: '', index: true, },
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
    fileContentAi: {
        type: String,
        default: '',
    },
    fileUrlArr: {
        type: [String],
        default: [],
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