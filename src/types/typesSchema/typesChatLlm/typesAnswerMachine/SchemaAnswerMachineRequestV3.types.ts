import mongoose, { Document } from 'mongoose';

/** Answer Machine V3 root run (“request”) */
export interface IAnswerMachineRequestV3 extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    parentMessageId: mongoose.Types.ObjectId;
    username: string;

    schemaVersion: 3;

    status: 'pending' | 'answered' | 'error';
    errorReason: string;
    usedOpencode: boolean;
    usedWebSearch: boolean;

    minNumberOfIterations: number;
    maxNumberOfIterations: number;
    currentIteration: number;

    intermediateAnswers: string[];
    finalAnswer: string;
    isSatisfactoryFinalAnswer?: boolean;

    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalReasoningTokens: number;
    totalTokens: number;
    costInUsd: number;

    /** Objective for the full run (copied from the initiating chat message at create time). */
    globalTaskDescription: string;

    createdAt: Date;
    updatedAt: Date;
}
