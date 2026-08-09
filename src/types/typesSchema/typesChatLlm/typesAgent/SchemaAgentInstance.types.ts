import mongoose, { Document } from 'mongoose';

export type AgentInstanceStatus = 'pending' | 'success' | 'failed';

/**
 * Current phase inside the Agent Brain loop:
 * Think → Plan → Use Tool → Observe → (Repeat) → Final Answer → done
 */
export type AgentInstanceBrainStep =
    | 'think'
    | 'plan'
    | 'use_tool'
    | 'observe'
    | 'final_answer'
    | 'done'
    | null;

export interface IAgentInstance extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    parentMessageId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    status: AgentInstanceStatus;
    /** Current brain phase while status === pending */
    brainStep: AgentInstanceBrainStep;
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
    /** Snapshot of thread budgets at agent start */
    minBudgetTokens: number;
    maxBudgetTokens: number;
    minNumberOfIterations: number;
    maxNumberOfIterations: number;
    activeSkillNames: string[];
    createdAtUtc: Date;
    updatedAtUtc: Date;
}
