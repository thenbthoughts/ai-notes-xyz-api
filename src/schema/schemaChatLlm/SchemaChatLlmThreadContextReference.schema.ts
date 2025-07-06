import mongoose, { Schema } from 'mongoose';

import { IChatLlmThreadContextReference } from '../../types/typesSchema/typesChatLlm/SchemaChatLlmThreadContextReference.types';

// Chat Schema
const chatLlmThreadContextReferenceSchema = new Schema<IChatLlmThreadContextReference>({
    // fields
    referenceFrom: {
        type: String,
        default: '',
    },
    referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
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