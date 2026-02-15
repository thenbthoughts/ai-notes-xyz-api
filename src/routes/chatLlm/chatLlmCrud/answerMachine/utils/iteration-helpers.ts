import mongoose from "mongoose";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelAnswerMachineSubQuestion } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";
import {
    ChatLlmThread,
    ConversationMessage,
    ValidationResult,
    IterationLimits,
    LastMessageCheck,
    NoQuestionsCheck,
    EvaluationResult,
    IterationDecision
} from "../types/answer-machine.types";

/**
 * Iteration-related helper functions
 */

/**
 * Check if we've reached iteration limits
 */
export const checkIterationLimits = (
    currentIteration: number,
    minIterations: number,
    maxIterations: number
): IterationLimits => {
    const hasReachedMin = currentIteration >= minIterations;
    const hasReachedMax = currentIteration >= maxIterations;
    const shouldContinue = !hasReachedMax;

    return {
        hasReachedMin,
        hasReachedMax,
        shouldContinue,
    } as IterationLimits;
};

/**
 * Update thread status - single source of truth for status updates
 * Note: Most status fields are now on the answer machine record
 */
export const updateThreadStatus = async (
    threadId: mongoose.Types.ObjectId,
    status: 'pending' | 'answered' | 'error',
    updates?: {
        errorReason?: string;
    }
): Promise<void> => {
    // Since status fields moved to answer machine record,
    // this function now primarily handles any remaining thread-level updates
    // For now, it does nothing but is kept for backward compatibility
};

/**
 * Determine if we should continue to next iteration based on evaluation and limits
 */
export const shouldContinueIteration = (
    evaluation: EvaluationResult,
    limits: IterationLimits
): IterationDecision => {
    // If we've reached max iterations, we must stop
    if (limits.hasReachedMax) {
        return {
            shouldContinue: false,
            reason: 'Max iterations reached',
        } as IterationDecision;
    }

    // If answer is not satisfactory and has gaps, continue
    if (!evaluation.isSatisfactory && evaluation.gaps.length > 0) {
        return {
            shouldContinue: true,
            reason: 'Answer not satisfactory, gaps identified',
        } as IterationDecision;
    }

    // If answer is satisfactory but haven't reached min iterations, continue
    if (evaluation.isSatisfactory && !limits.hasReachedMin) {
        return {
            shouldContinue: true,
            reason: 'Answer satisfactory but minimum iterations not reached',
        } as IterationDecision;
    }

    // If answer is satisfactory and reached min iterations, stop
    if (evaluation.isSatisfactory && limits.hasReachedMin) {
        return {
            shouldContinue: false,
            reason: 'Answer satisfactory and minimum iterations reached',
        } as IterationDecision;
    }

    // Edge case: not satisfactory but no gaps
    // If we've reached min iterations, stop (can't improve without gaps)
    if (!evaluation.isSatisfactory && evaluation.gaps.length === 0) {
        if (limits.hasReachedMin) {
            return {
                shouldContinue: false,
                reason: 'Minimum iterations reached, no gaps to address',
            } as IterationDecision;
        } else {
            // Continue anyway to reach minimum iterations
            return {
                shouldContinue: true,
                reason: 'Continue to reach minimum iterations despite no gaps',
            } as IterationDecision;
        }
    }

    // Default: continue (shouldn't reach here)
    return {
        shouldContinue: true,
        reason: 'Continue iteration',
    } as IterationDecision;
};

/**
 * Get previous gaps from evaluation for iteration processing
 */
export const getPreviousGaps = (
    currentIteration: number,
    previousGapsFromEvaluation?: string[]
): {
    previousGaps: string[];
    isContinuingForMinIterations: boolean;
    needsEvaluation: boolean;
} => {
    const gaps = previousGapsFromEvaluation || [];

    if (currentIteration === 1) {
        return {
            previousGaps: [],
            isContinuingForMinIterations: false,
            needsEvaluation: false,
        };
    }

    if (gaps.length > 0) {
        return {
            previousGaps: gaps,
            isContinuingForMinIterations: false,
            needsEvaluation: false,
        };
    }

    // Need to evaluate previous iteration
    return {
        previousGaps: [],
        isContinuingForMinIterations: true,
        needsEvaluation: true,
    };
};

/**
 * Handle case where last message is already AI (iteration 1 only)
 * Returns whether to continue or complete
 */
export const handleLastMessageIsAi = async (
    currentIteration: number,
    conversationList: ConversationMessage[],
    limits: IterationLimits,
    minIterations: number
): Promise<LastMessageCheck> => {
    // Only handle in iteration 1
    if (currentIteration !== 1) {
        return { shouldHandle: false, shouldComplete: false } as LastMessageCheck;
    }

    const lastMessage = conversationList[conversationList.length - 1];
    if (!lastMessage || !lastMessage.isAi) {
        return { shouldHandle: false, shouldComplete: false } as LastMessageCheck;
    }

    // Last message is AI - check if we should complete or continue
    return {
        shouldHandle: true,
        shouldComplete: limits.hasReachedMin,
    } as LastMessageCheck;
};

/**
 * Handle case where no questions are generated
 * Returns whether to complete early
 */
export const handleNoQuestionsGenerated = async (
    currentIteration: number,
    threadId: mongoose.Types.ObjectId,
    username: string,
    limits: IterationLimits,
    minIterations: number
): Promise<NoQuestionsCheck> => {
    // Only check in iteration 1
    if (currentIteration !== 1) {
        return { shouldComplete: false } as NoQuestionsCheck;
    }

    // Check if there are any existing answered sub-questions from previous runs
    const existingAnsweredQuestions = await ModelAnswerMachineSubQuestion.find({
        threadId,
        username,
        status: 'answered',
    });

    // If no questions needed and no existing answers, check if we can complete
    if (existingAnsweredQuestions.length === 0) {
        return {
            shouldComplete: limits.hasReachedMin,
        } as NoQuestionsCheck;
    }

    // If there are existing answered questions, continue
    return { shouldComplete: false } as NoQuestionsCheck;
};

/**
 * Validate and get thread settings
 */
export const validateAndGetSettings = async (
    threadId: mongoose.Types.ObjectId
): Promise<ValidationResult> => {
    console.log(`[Validate Settings] Looking for thread: ${threadId}`);
    const thread = await ModelChatLlmThread.findById(threadId);

    if (!thread) {
        console.log(`[Validate Settings] Thread not found: ${threadId}`);
        return {
            success: false,
            errorReason: 'Thread not found',
        } as ValidationResult;
    }

    console.log(`[Validate Settings] Found thread: ${thread._id}, username: ${thread.username}`);

    const minIterations = thread.answerMachineMinNumberOfIterations || 1;
    const maxIterations = thread.answerMachineMaxNumberOfIterations || 1;

    // Validate iteration settings
    if (minIterations > maxIterations) {
        return {
            success: false,
            errorReason: `Invalid iteration settings: min (${minIterations}) > max (${maxIterations})`,
        } as ValidationResult;
    }

    return {
        success: true,
        thread,
        minIterations,
        maxIterations,
    } as ValidationResult;
};