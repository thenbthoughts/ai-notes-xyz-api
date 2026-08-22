import mongoose, { Document } from 'mongoose';

export type AgentOpencodeInstanceStatus = 'pending' | 'filesInitialized' | 'failed';

/**
 * Isolated Agent (Opencode) run. Message send only inserts a pending row;
 * cron later creates the workspace files.
 */
export interface IAgentOpencodeInstance extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    parentMessageId: mongoose.Types.ObjectId;
    chatMessageId: mongoose.Types.ObjectId | null;
    userId: mongoose.Types.ObjectId;
    status: AgentOpencodeInstanceStatus;
    statusIsRunning: boolean;
    errorReason: string;
    promptText: string;
    workspaceRootRelativePath: string;
    inputPromptRelativePath: string;
    outputPromptRelativePath: string;
    agentWorkspaceRelativePath: string;
    pipelineStep: 'input' | 'settings' | 'opencode' | 'output' | 'done' | '';
    opencodeRunId: string;
    filesInitializedAtUtc: Date | null;
    createdAtUtc: Date;
    updatedAtUtc: Date;
}
