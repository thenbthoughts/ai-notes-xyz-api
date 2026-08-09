import mongoose, { Document } from 'mongoose';

/** One citation/source linked to an agent final answer. */
export interface IAgentCitation extends Document {
    _id: mongoose.Types.ObjectId;
    agentFinalId: mongoose.Types.ObjectId;
    chatMessageId: mongoose.Types.ObjectId;
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    /** Domain: notes | tasks | memo | lifeEvents | infoVault */
    source: string;
    /** ID of the source record in its domain collection */
    sourceRecordId: string;
    title: string;
    summary: string;
    orderIndex: number;
    createdAtUtc: Date;
    updatedAtUtc: Date;
}
