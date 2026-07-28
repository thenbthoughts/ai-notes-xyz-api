import mongoose, { Document } from 'mongoose';

export type AgentGoalStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface IAgentGoal extends Document {
    _id: mongoose.Types.ObjectId;
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    orderIndex: number;
    title: string;
    description: string;
    status: AgentGoalStatus;
    result: string;
    createdAtUtc: Date;
    updatedAtUtc: Date;
    completedAtUtc: Date | null;
}
