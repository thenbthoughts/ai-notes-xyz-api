import mongoose from "mongoose";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { ModelAnswerMachineSubQuestion } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";

/**
 * Check if we've reached iteration limits
 */
export const checkIterationLimits = (
    currentIteration: number,
    minIterations: number,
    maxIterations: number
): {
    hasReachedMin: boolean;
    hasReachedMax: boolean;
    shouldContinue: boolean;
} => {
    const hasReachedMin = currentIteration >= minIterations;
    const hasReachedMax = currentIteration >= maxIterations;
    const shouldContinue = !hasReachedMax;

    return {
        hasReachedMin,
        hasReachedMax,
        shouldContinue,
    };
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
    evaluation: {
        isSatisfactory: boolean;
        gaps: string[];
    },
    limits: {
        hasReachedMin: boolean;
        hasReachedMax: boolean;
    }
): {
    shouldContinue: boolean;
    reason: string;
} => {
    // If we've reached max iterations, we must stop
    if (limits.hasReachedMax) {
        return {
            shouldContinue: false,
            reason: 'Max iterations reached',
        };
    }

    // If answer is not satisfactory and has gaps, continue
    if (!evaluation.isSatisfactory && evaluation.gaps.length > 0) {
        return {
            shouldContinue: true,
            reason: 'Answer not satisfactory, gaps identified',
        };
    }

    // If answer is satisfactory but haven't reached min iterations, continue
    if (evaluation.isSatisfactory && !limits.hasReachedMin) {
        return {
            shouldContinue: true,
            reason: 'Answer satisfactory but minimum iterations not reached',
        };
    }

    // If answer is satisfactory and reached min iterations, stop
    if (evaluation.isSatisfactory && limits.hasReachedMin) {
        return {
            shouldContinue: false,
            reason: 'Answer satisfactory and minimum iterations reached',
        };
    }

    // Edge case: not satisfactory but no gaps
    // If we've reached min iterations, stop (can't improve without gaps)
    if (!evaluation.isSatisfactory && evaluation.gaps.length === 0) {
        if (limits.hasReachedMin) {
            return {
                shouldContinue: false,
                reason: 'Minimum iterations reached, no gaps to address',
            };
        } else {
            return {
                shouldContinue: true,
                reason: 'Minimum iterations not reached, continuing',
            };
        }
    }

    // Default: continue if we haven't reached min iterations
    return {
        shouldContinue: !limits.hasReachedMin,
        reason: limits.hasReachedMin ? 'Minimum iterations reached' : 'Continuing for minimum iterations',
    };
};

/**
 * Validate thread and get iteration settings
 */
export const validateAndGetSettings = async (
    threadId: mongoose.Types.ObjectId
): Promise<{
    success: boolean;
    thread?: any;
    minIterations?: number;
    maxIterations?: number;
    errorReason?: string;
}> => {
    const thread = await ModelChatLlmThread.findById(threadId);

    if (!thread) {
        return {
            success: false,
            errorReason: 'Thread not found',
        };
    }

    const minIterations = thread.answerMachineMinNumberOfIterations || 1;
    const maxIterations = thread.answerMachineMaxNumberOfIterations || 1;

    // Validate iteration settings
    if (minIterations > maxIterations) {
        return {
            success: false,
            errorReason: `Invalid iteration settings: min (${minIterations}) > max (${maxIterations})`,
        };
    }

    return {
        success: true,
        thread,
        minIterations,
        maxIterations,
    };
};

/**
 * Handle case where last message is already AI (iteration 1 only)
 * Returns whether to continue or complete
 */
export const handleLastMessageIsAi = async (
    currentIteration: number,
    conversationList: IChatLlm[],
    limits: { hasReachedMin: boolean },
    minIterations: number
): Promise<{
    shouldHandle: boolean;
    shouldComplete: boolean;
}> => {
    // Only handle in iteration 1
    if (currentIteration !== 1) {
        return { shouldHandle: false, shouldComplete: false };
    }

    const lastMessage = conversationList[conversationList.length - 1];
    if (!lastMessage || !lastMessage.isAi) {
        return { shouldHandle: false, shouldComplete: false };
    }

    // Last message is AI - check if we should complete or continue
    return {
        shouldHandle: true,
        shouldComplete: limits.hasReachedMin,
    };
};

/**
 * Handle case where no questions are generated
 * Returns whether to complete early
 */
export const handleNoQuestionsGenerated = async (
    currentIteration: number,
    threadId: mongoose.Types.ObjectId,
    username: string,
    limits: { hasReachedMin: boolean },
    minIterations: number
): Promise<{
    shouldComplete: boolean;
}> => {
    // Only check in iteration 1
    if (currentIteration !== 1) {
        return { shouldComplete: false };
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
        };
    }

    // If there are existing answered questions, continue
    return { shouldComplete: false };
};

/**
 * Get previous gaps for iteration > 1
 */
export const getPreviousGaps = (
    currentIteration: number,
    previousGapsFromEvaluation?: string[]
): {
    previousGaps: string[];
    isContinuingForMinIterations: boolean;
    needsEvaluation: boolean;
} => {
    if (currentIteration === 1) {
        return {
            previousGaps: [],
            isContinuingForMinIterations: false,
            needsEvaluation: false,
        };
    }

    // If gaps were explicitly passed
    if (previousGapsFromEvaluation !== undefined) {
        const isContinuingForMinIterations = previousGapsFromEvaluation.length === 0;
        return {
            previousGaps: previousGapsFromEvaluation,
            isContinuingForMinIterations,
            needsEvaluation: false,
        };
    }

    // Need to evaluate previous iteration
    return {
        previousGaps: [],
        isContinuingForMinIterations: false,
        needsEvaluation: true,
    };
};
