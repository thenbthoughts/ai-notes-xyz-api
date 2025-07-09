import mongoose, { Schema } from 'mongoose';

import { IChatLlmThreadContextReference } from '../../types/typesSchema/typesChatLlm/SchemaChatLlmThreadContextReference.types';

// Chat Schema
const chatLlmThreadContextReferenceSchema = new Schema<IChatLlmThreadContextReference>({
    // fields
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    referenceFrom: {
        type: String,
        default: '',
        // note, task, chat, memo, life-event, info-vault etc.
    },
    referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    isAddedByAi: {
        type: Boolean,
        default: false,
    },

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
const ModelChatLlmThreadContextReference = mongoose.model<IChatLlmThreadContextReference>(
    'chatLlmThreadContextReference',
    chatLlmThreadContextReferenceSchema,
    'chatLlmThreadContextReference'
);

export {
    ModelChatLlmThreadContextReference  
};