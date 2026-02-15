import mongoose from "mongoose";
import { ModelChatLlmAnswerMachineTokenRecord } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachineTokenRecord.schema";

/**
 * Extract token information from fetchLlmUnified raw response
 */
export const extractTokensFromRawResponse = (raw: any): {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
} => {
    // Try to extract from OpenAI-compatible format
    const usage = raw?.usage || raw?.data?.usage;

    let promptTokens = 0;
    let completionTokens = 0;
    let reasoningTokens = 0;
    let totalTokens = 0;

    if (usage) {
        // OpenAI/OpenRouter format
        promptTokens = usage.prompt_tokens || usage.promptTokens || 0;
        completionTokens = usage.completion_tokens || usage.completionTokens || 0;
        reasoningTokens = usage.reasoning_tokens || usage.reasoningTokens || 0;
        totalTokens = usage.total_tokens || usage.totalTokens || (promptTokens + completionTokens + reasoningTokens);
    } else {
        // Try Ollama format
        if (raw?.prompt_eval_count !== undefined) {
            promptTokens = raw.prompt_eval_count;
        }
        if (raw?.eval_count !== undefined) {
            completionTokens = raw.eval_count;
        }
        totalTokens = promptTokens + completionTokens;
    }

    return {
        promptTokens,
        completionTokens,
        reasoningTokens,
        totalTokens: totalTokens || (promptTokens + completionTokens + reasoningTokens),
    };
};

/**
 * Calculate cost in USD based on tokens and model
 * This is a simplified calculation - adjust based on your pricing model
 */
export const calculateCostInUsd = (
    promptTokens: number,
    completionTokens: number,
    reasoningTokens: number,
    model: string,
    provider: string
): number => {
    // Default pricing (adjust based on your actual pricing)
    // These are example rates per 1M tokens
    const promptRatePerMillion = 0.5; // $0.50 per 1M prompt tokens
    const completionRatePerMillion = 1.5; // $1.50 per 1M completion tokens
    const reasoningRatePerMillion = 0.3; // $0.30 per 1M reasoning tokens

    const promptCost = (promptTokens / 1_000_000) * promptRatePerMillion;
    const completionCost = (completionTokens / 1_000_000) * completionRatePerMillion;
    const reasoningCost = (reasoningTokens / 1_000_000) * reasoningRatePerMillion;

    return promptCost + completionCost + reasoningCost;
};

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
 * Track tokens for answer machine - stores individual token records
 * Aggregated totals are calculated dynamically when needed
 */
export const trackAnswerMachineTokens = async (
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