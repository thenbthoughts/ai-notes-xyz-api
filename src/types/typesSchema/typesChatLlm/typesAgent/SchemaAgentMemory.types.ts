import mongoose, { Document } from 'mongoose';

export interface IAgentMemory extends Document {
    _id: mongoose.Types.ObjectId;
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    key: string;
    content: string;
    memoryType: 'fact' | 'observation' | 'plan' | 'result' | 'other';
    /** Copied from a previous instance for context. Do not count toward usage. */
    past: boolean;
    createdAtUtc: Date;
    updatedAtUtc: Date;
}
