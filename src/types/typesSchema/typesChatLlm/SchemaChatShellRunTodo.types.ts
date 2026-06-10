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
    userId: mongoose.Types.ObjectId;
    executeStrategyBy: ChatShellExecuteStrategy;
    taskName: string;
    shellCommand: string;
    /** Optional post-primary check; must exit 0 after primary succeeds. */
    verifyShellCommand: string;
    status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    orderIndex: number;
    /** Number of primary execute attempts that ran. */
    attemptCount: number;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    /** Exit code of verifyShellCommand when run; null if not run or N/A. */
    verifyExitCode: number | null;
    createdAtUtc: Date | null;
    updatedAtUtc: Date | null;
}
