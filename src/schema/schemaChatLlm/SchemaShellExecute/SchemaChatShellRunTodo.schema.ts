import mongoose, { Schema } from 'mongoose';

import { IChatShellRunTodo } from '../../../types/typesSchema/typesChatLlm/SchemaChatShellRunTodo.types';

const chatShellRunTodoSchema = new Schema<IChatShellRunTodo>({
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
    username: { type: String, required: true, index: true },
    executeStrategyBy: {
        type: String,
        enum: ['llm', 'shellExecute', 'browserIntegration', 'internalKnowledgeAndLlm'],
        required: true,
    },
    taskName: { type: String, required: true, default: '' },
    shellCommand: { type: String, default: '' },
    status: {
        type: String,
        enum: ['pending', 'running', 'done', 'failed', 'skipped'],
        default: 'pending',
    },
    orderIndex: { type: Number, default: 0 },
    stdout: { type: String, default: '' },
    stderr: { type: String, default: '' },
    exitCode: { type: Number, default: null },
    createdAtUtc: { type: Date, default: null },
    updatedAtUtc: { type: Date, default: null },
});

const ModelChatShellRunTodo = mongoose.model<IChatShellRunTodo>(
    'chatShellRunTodo',
    chatShellRunTodoSchema,
    'chatShellRunTodo',
);

export { ModelChatShellRunTodo };
