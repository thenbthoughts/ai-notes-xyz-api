import mongoose, { Schema } from 'mongoose';

import { IChatShellRunGroup } from '../../../types/typesSchema/typesChatLlm/SchemaChatShellRunGroup.types';

const chatShellRunGroupSchema = new Schema<IChatShellRunGroup>({
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, index: true },
    status: {
        type: String,
        enum: ['pending', 'running', 'completed', 'error'],
        default: 'pending',
        index: true,
    },
    errorReason: { type: String, default: '' },
    createdAtUtc: { type: Date, default: null },
    updatedAtUtc: { type: Date, default: null },
});

const ModelChatShellRunGroup = mongoose.model<IChatShellRunGroup>(
    'chatShellRunGroup',
    chatShellRunGroupSchema,
    'chatShellRunGroup',
);

export { ModelChatShellRunGroup };
