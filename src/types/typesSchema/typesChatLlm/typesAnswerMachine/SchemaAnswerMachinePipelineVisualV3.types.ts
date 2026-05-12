import mongoose, { Document } from 'mongoose';

/**
 * Per–outer-iteration visual record for Answer Machine V3 (input/output pipeline images).
 * One document per (answerMachineRequestV3Id, answerMachineIteration).
 */
export interface IAnswerMachinePipelineVisualV3 extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;
    answerMachineRequestV3Id: mongoose.Types.ObjectId;
    answerMachineIteration: number;
    /** Stored object key / path served via uploads getFile (same convention as file artifacts). */
    inputImageStoredFileUrl: string;
    outputImageStoredFileUrl: string;
    schemaVersion: number;
    createdAt: Date;
    updatedAt: Date;
}
