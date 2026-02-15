import mongoose, { Document } from 'mongoose';

// Live record for Answer Machine run
export interface IChatLlmAnswerMachine extends Document {
    // references
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    parentMessageId: mongoose.Types.ObjectId;

    // auth
    username: string;

    // status
    status: 'pending' | 'answered' | 'error';
    errorReason: string;
    usedOpencode: boolean;
    usedWebSearch: boolean;

    // iteration tracking
    minNumberOfIterations: number;
    maxNumberOfIterations: number;
    currentIteration: number;

    // answers
    intermediateAnswers: string[];
    finalAnswer: string;

    // token tracking
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalReasoningTokens: number;
    totalTokens: number;
    costInUsd: number;

    // timestamps
    createdAt: Date;
    updatedAt: Date;
}