import mongoose, { Schema } from 'mongoose';

import { IChatShellGeneratedFile } from '../../../types/typesSchema/typesChatLlm/SchemaChatShellGeneratedFile.types';

const chatShellGeneratedFileSchema = new Schema<IChatShellGeneratedFile>({
    chatShellRunGroupId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatShellRunGroup',
    },
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, index: true },
    todoId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        ref: 'chatShellRunTodo',
    },
    relativePath: { type: String, default: '' },
    storedFileUrl: { type: String, default: '' },
    fileName: { type: String, default: '' },
    mimeType: { type: String, default: 'application/octet-stream' },
    summary: { type: String, default: '' },
    createdAtUtc: { type: Date, default: null },
});

const ModelChatShellGeneratedFile = mongoose.model<IChatShellGeneratedFile>(
    'chatShellGeneratedFile',
    chatShellGeneratedFileSchema,
    'chatShellGeneratedFile',
);

export { ModelChatShellGeneratedFile };
