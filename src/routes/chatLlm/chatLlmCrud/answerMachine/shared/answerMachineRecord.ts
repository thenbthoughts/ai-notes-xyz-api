import mongoose from "mongoose";
import { ModelChatLlmAnswerMachine } from "../../../../../schema/schemaChatLlm/SchemaChatLlmAnswerMachine.schema";
import { ModelChatLlmAnswerMachineTokenRecord } from "../../../../../schema/schemaChatLlm/SchemaChatLlmAnswerMachineTokenRecord.schema";

/**
 * Update answer machine record with new data
 */
export const updateAnswerMachineRecord = async (
    answerMachineId: mongoose.Types.ObjectId,
    updates: {
        currentIteration?: number;
        intermediateAnswers?: string[];
        finalAnswer?: string;
        totalPromptTokens?: number;
        totalCompletionTokens?: number;
        totalReasoningTokens?: number;
        totalTokens?: number;
        costInUsd?: number;
        status?: 'pending' | 'answered' | 'error';
        errorReason?: string;
    }
) => {
    await ModelChatLlmAnswerMachine.findByIdAndUpdate(answerMachineId, {
        $set: { ...updates, updatedAtUtc: new Date() }
    });
};

/**
 * Track tokens for answer machine - stores individual token records
 * Aggregated totals are calculated dynamically when needed
 */
export const trackAnswerMachineTokens = async (
    answerMachineId: mongoose.Types.ObjectId,
    threadId: mongoose.Types.ObjectId,
    tokens: {
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
    },
    username: string,
    queryType?: 'question_generation' | 'sub_question_answer' | 'intermediate_answer' | 'evaluation' | 'final_answer'
): Promise<void> => {
    try {
        // Create individual token record for this execution
        if (queryType) {
            await ModelChatLlmAnswerMachineTokenRecord.create({
                answerMachineId,
                threadId,
                username,
                queryType,
                promptTokens: tokens.promptTokens,
                completionTokens: tokens.completionTokens,
                reasoningTokens: tokens.reasoningTokens,
                totalTokens: tokens.totalTokens,
                costInUsd: tokens.costInUsd,
            });
        }
    } catch (error) {
        console.error(`[Token Tracking] Error tracking tokens for thread ${threadId}:`, error);
    }
};