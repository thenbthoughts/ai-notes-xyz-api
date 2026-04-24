import mongoose, { Schema } from 'mongoose';

import { IChatLlmThreadOpencodeSession } from '../../types/typesSchema/typesChatLlm/SchemaChatLlmThreadOpencodeSession.types';

const chatLlmThreadOpencodeSessionSchema = new Schema<IChatLlmThreadOpencodeSession>({
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    username: {
        type: String,
        required: true,
        index: true,
    },
    workspaceDirectory: {
        type: String,
        default: '',
    },
    sdkSessionId: {
        type: String,
        default: '',
    },
    createdAtUtc: {
        type: Date,
        default: new Date(),
    },
    updatedAtUtc: {
        type: Date,
        default: new Date(),
    },
});

chatLlmThreadOpencodeSessionSchema.index({ threadId: 1, username: 1 }, { unique: true });

const ModelChatLlmThreadOpencodeSession = mongoose.model<IChatLlmThreadOpencodeSession>(
    'chatLlmThreadOpencodeSession',
    chatLlmThreadOpencodeSessionSchema,
    'chatLlmThreadOpencodeSession'
);

export { ModelChatLlmThreadOpencodeSession };

