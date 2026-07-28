import mongoose, { Document } from 'mongoose';

export type AgentInstanceStatus = 'running' | 'paused' | 'stopped' | 'completed' | 'error';

export interface IAgentInstance extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    parentMessageId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    status: AgentInstanceStatus;
    errorReason: string;
    tickCount: number;
    lastTickAtUtc: Date | null;
    tickLockUntilUtc: Date | null;
    cancellationRequestedUtc: Date | null;
    summary: string;
    createdAtUtc: Date;
    updatedAtUtc: Date;
}
