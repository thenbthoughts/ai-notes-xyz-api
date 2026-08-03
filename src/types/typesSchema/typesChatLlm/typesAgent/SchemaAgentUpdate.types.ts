import mongoose, { Document } from 'mongoose';

export type AgentUpdateType =
    | 'status'
    | 'goal_started'
    | 'goal_completed'
    | 'goal_failed'
    | 'memory_written'
    | 'domain_search'
    | 'message'
    | 'error'
    | 'tick'
    | 'excel_created'
    | 'script_executed'
    | 'tool_result';

export interface IAgentUpdate extends Document {
    _id: mongoose.Types.ObjectId;
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    updateType: AgentUpdateType;
    message: string;
    payload: Record<string, unknown>;
    goalId: mongoose.Types.ObjectId | null;
    tickNumber: number;
    createdAtUtc: Date;
}
