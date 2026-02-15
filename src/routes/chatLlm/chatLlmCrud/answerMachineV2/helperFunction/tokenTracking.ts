import mongoose from "mongoose";
import { ModelChatLlmAnswerMachineTokenRecord } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachineTokenRecord.schema";


/**
 * Aggregate token information
 */
export const aggregateTokens = (
    tokens: Array<{
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
    }>
): {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    costInUsd: number;
} => {
    return tokens.reduce(
        (acc, token) => ({
            promptTokens: acc.promptTokens + token.promptTokens,
            completionTokens: acc.completionTokens + token.completionTokens,
            reasoningTokens: acc.reasoningTokens + token.reasoningTokens,
            totalTokens: acc.totalTokens + token.totalTokens,
            costInUsd: acc.costInUsd + token.costInUsd,
        }),
        {
            promptTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
            costInUsd: 0,
        }
    );
};

/**
 * Track tokens for answer machine - stores individual token records using usageStats from fetchLlmUnified
 * Aggregated totals are calculated dynamically when needed
 */
export const trackAnswerMachineTokens = async (
    threadId: mongoose.Types.ObjectId,
    usageStats: {
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
                threadId,
                username,
                queryType,
                promptTokens: usageStats.promptTokens,
                completionTokens: usageStats.completionTokens,
                reasoningTokens: usageStats.reasoningTokens,
                totalTokens: usageStats.totalTokens,
                costInUsd: usageStats.costInUsd,
            });
        }
    } catch (error) {
        console.error(`[Token Tracking] Error tracking tokens for thread ${threadId}:`, error);
    }
};