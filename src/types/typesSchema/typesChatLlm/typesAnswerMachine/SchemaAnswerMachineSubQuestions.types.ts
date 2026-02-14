import mongoose, { Document } from 'mongoose';

// Answer Machine Sub Question Interface
export interface IAnswerMachineSubQuestion extends Document {
    // identification
    _id: mongoose.Types.ObjectId;
    answerMachineId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId | null;
    parentMessageId: mongoose.Types.ObjectId | null; // Refers to the main user's message

    // fields
    question: string; // The actual sub-question text
    answerReasoningContent?: string; // The reasoning content for the sub-question
    answer: string; // The answer to the sub-question
    contextIds: mongoose.Types.ObjectId[]; // The context ids for the sub-question
    
    // status
    status: 'pending' | 'answered' | 'skipped' | 'error'; // Progress of answering the sub-question
    errorReason?: string;

    // auth
    username: string;

    // model info
    aiModelName: string;
    aiModelProvider: string;

    // auto
    createdAtUtc?: Date | null;
    updatedAtUtc?: Date | null;

    // Statistics and cost
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    costInUsd?: number;
}