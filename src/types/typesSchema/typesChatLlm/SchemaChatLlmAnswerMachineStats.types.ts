import mongoose, { Document } from 'mongoose';

// Completed stats record for Answer Machine run
export interface IChatLlmAnswerMachineStats extends Document {
    // reference to the live record
    _id: mongoose.Types.ObjectId;
    answerMachineId: mongoose.Types.ObjectId;

    // references
    threadId: mongoose.Types.ObjectId;
    parentMessageId: mongoose.Types.ObjectId;

    // auth
    username: string;

    // summary counts
    subQuestionsCount: number;
    intermediateAnswersCount: number;

    // final answer
    finalAnswer: string;

    // status
    status: 'answered' | 'error';

    // token tracking (final aggregated totals)
    tokenBreakdown: Map<string, {
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
        count: number;
        maxSingleQueryTokens: number;
    }>;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalReasoningTokens: number;
    totalTokens: number;
    costInUsd: number;

    // timestamp
    createdAtUtc: Date;
}