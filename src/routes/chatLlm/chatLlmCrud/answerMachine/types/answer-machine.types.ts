import mongoose from "mongoose";

// Token response types
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    costInUsd: number;
}

export interface LlmRawResponse {
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        completion_tokens_details?: {
            reasoning_tokens?: number;
        };
    };
    data?: {
        usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            completion_tokens_details?: {
                reasoning_tokens?: number;
            };
        };
    };
    prompt_eval_count?: number;
    eval_count?: number;
}

// Search result types
export interface SearchResultItem {
    _id: mongoose.Types.ObjectId;
    entityId: mongoose.Types.ObjectId;
    title?: string;
    content?: string;
    tags?: string[];
    updatedAtUtc?: Date;
}

export interface ScoredSearchResult {
    entityId: mongoose.Types.ObjectId;
    relevanceScore: number;
    relevanceReason: string;
}

// Thread types
export interface ChatLlmThread {
    _id: mongoose.Types.ObjectId;
    username: string;
    title?: string;
    systemPrompt?: string;
    answerMachineId?: mongoose.Types.ObjectId | null;
    answerMachineMinNumberOfIterations?: number;
    answerMachineMaxNumberOfIterations?: number;
    createdAtUtc: Date;
    updatedAtUtc: Date;
}

// Conversation message types
export interface ConversationMessage {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId | null;
    type: string;
    content: string;
    reasoningContent?: string;
    username: string;
    isAi: boolean;
    createdAtUtc: Date;
    updatedAtUtc: Date;
}

// Task types
export interface TaskItem {
    _id: mongoose.Types.ObjectId;
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    dueDate?: Date;
    createdAtUtc?: Date;
    updatedAtUtc?: Date;
}

// Note types
export interface NoteItem {
    _id: mongoose.Types.ObjectId;
    title?: string;
    content?: string;
    tags?: string[];
    createdAtUtc?: Date;
    updatedAtUtc?: Date;
}

// Life event types
export interface LifeEventItem {
    _id: mongoose.Types.ObjectId;
    title?: string;
    description?: string;
    eventDateUtc?: Date;
    categoryId?: string;
    tags?: string[];
    createdAtUtc?: Date;
    updatedAtUtc?: Date;
}

// Info vault types
export interface InfoVaultItem {
    _id: mongoose.Types.ObjectId;
    title?: string;
    name?: string;
    content?: string;
    category?: string;
    tags?: string[];
    createdAtUtc?: Date;
    updatedAtUtc?: Date;
}

// Token breakdown type
export type TokenBreakdown = Record<string, {
    count: number;
    totalTokens: number;
    totalCost: number;
    avgTokens: number;
    maxTokens: number;
}>;

// Validation result types
export interface ValidationResult {
    success: boolean;
    thread?: ChatLlmThread;
    minIterations?: number;
    maxIterations?: number;
    errorReason?: string;
}

// Iteration processing result types
export interface IterationLimits {
    hasReachedMin: boolean;
    hasReachedMax: boolean;
    shouldContinue: boolean;
}

export interface LastMessageCheck {
    shouldHandle: boolean;
    shouldComplete: boolean;
}

export interface NoQuestionsCheck {
    shouldComplete: boolean;
}

export interface EvaluationResult {
    isSatisfactory: boolean;
    gaps: string[];
    reasoning: string;
}

export interface IterationDecision {
    shouldContinue: boolean;
    reason: string;
}

export interface IterationResult {
    shouldContinue: boolean;
    nextGaps?: string[];
    errorReason?: string;
}

// Run management types
export interface ContinuationInfo {
    answerMachineId: mongoose.Types.ObjectId;
    currentIteration: number;
}

export interface RunInitializationResult {
    success: boolean;
    answerMachineId?: mongoose.Types.ObjectId;
    currentIteration?: number;
    errorReason?: string;
}

// Answer machine orchestrator result
export interface AnswerMachineResult {
    success: boolean;
    errorReason: string;
    data: null;
}