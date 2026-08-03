import mongoose from 'mongoose';
import { IAgentGoal } from '../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentGoal.types';
import { IAgentMemory } from '../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentMemory.types';
import { IAgentUpdate } from '../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentUpdate.types';
import { AgentLogContext } from './agentWriteLog';

export interface AgentToolContext {
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    currentGoal: IAgentGoal;
    memories: IAgentMemory[];
    recentUpdates: IAgentUpdate[];
    tickNumber: number;
    llmConfig?: {
        provider: string;
        apiKey: string;
        apiEndpoint?: string;
        model: string;
        customHeaders?: Record<string, string>;
    } | null;
    logCtx: AgentLogContext;
}

export interface AgentToolResult {
    success: boolean;
    action: string;
    resultSummary: string;
    payload?: Record<string, unknown>;
    error?: string;
}

export interface AgentToolDefinition {
    name: string;
    description: string;
    execute: (ctx: AgentToolContext, args: Record<string, unknown>) => Promise<AgentToolResult>;
}
