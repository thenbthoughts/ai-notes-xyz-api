import mongoose, { Document } from 'mongoose';

export type ChatShellExecuteStrategy =
    | 'llm'
    | 'shellExecute'
    | 'browserIntegration'
    | 'internalKnowledgeAndLlm';

export interface IChatShellRunTodo extends Document {
    _id: mongoose.Types.ObjectId;
    chatShellRunGroupId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;
    executeStrategyBy: ChatShellExecuteStrategy;
    taskName: string;
    shellCommand: string;
    status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    orderIndex: number;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    createdAtUtc: Date | null;
    updatedAtUtc: Date | null;
}
