import mongoose, { Document } from 'mongoose';

export type AgentInstanceStatus = 'pending' | 'success' | 'failed';

export interface IAgentInstance extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    parentMessageId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    status: AgentInstanceStatus;
    statusIsRunning: boolean;
    errorReason: string;
    tickCount: number;
    lastTickAtUtc: Date | null;
    tickLockUntilUtc: Date | null;
    cancellationRequestedUtc: Date | null;
    summary: string;
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    costInUsd: number;
    maxPromptTokensPerQuery: number;
    maxCompletionTokensPerQuery: number;
    activeSkillNames: string[];
    createdAtUtc: Date;
    updatedAtUtc: Date;
}
