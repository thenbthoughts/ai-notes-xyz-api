import mongoose, { Document } from 'mongoose';

export interface IAnswerMachineGenerateFinalAnswerV3 extends Document {
    _id: mongoose.Types.ObjectId;
    answerMachineRequestV3Id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;

    finalAnswerText: string;

    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    costInUsd: number;

    createdAtUtc: Date;
}
