import mongoose, { Document } from 'mongoose';

export interface IAnswerMachineEvaluateAnswerV3 extends Document {
    _id: mongoose.Types.ObjectId;
    answerMachineRequestV3Id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;

    isSatisfactory: boolean;
    confidence: number;
    evaluationReason: string;
    evaluationAllImpliedSubtasksDone: boolean;
    evaluationFinalAnswerDeliverable: boolean;
    evaluationGlobalTaskChecklist: string;

    insertedChatMessageId: mongoose.Types.ObjectId | null;

    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    costInUsd: number;

    createdAtUtc: Date;
}
