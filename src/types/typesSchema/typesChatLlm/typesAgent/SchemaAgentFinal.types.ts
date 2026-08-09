import mongoose, { Document } from 'mongoose';

/** Parent row for an agent final answer attached to a chat message. */
export interface IAgentFinal extends Document {
    _id: mongoose.Types.ObjectId;
    chatMessageId: mongoose.Types.ObjectId;
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    goalId: mongoose.Types.ObjectId | null;
    version: number;
    kind: 'agent_final';
    researchBrief: string;
    confidence: 'low' | 'medium' | 'high';
    createdAtUtc: Date;
    updatedAtUtc: Date;
}
