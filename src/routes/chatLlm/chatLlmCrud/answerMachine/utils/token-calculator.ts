import { TokenUsage, LlmRawResponse } from "../types/answer-machine.types";

/**
 * Token calculation utilities
 */

/**
 * Extract token information from fetchLlmUnified raw response
 */
export const extractTokensFromRawResponse = (raw: LlmRawResponse): TokenUsage => {
    // Try to extract from OpenAI-compatible format
    const usage = raw?.usage || raw?.data?.usage;

    let promptTokens = 0;
    let completionTokens = 0;
    let reasoningTokens = 0;
    let totalTokens = 0;

    if (usage) {
        // OpenAI/OpenRouter format
        promptTokens = usage.prompt_tokens || 0;
        completionTokens = usage.completion_tokens || 0;
        totalTokens = usage.total_tokens || 0;

        // Extract reasoning tokens if available
        if (usage.completion_tokens_details?.reasoning_tokens) {
            reasoningTokens = usage.completion_tokens_details.reasoning_tokens;
        }
    } else if (raw.prompt_eval_count !== undefined) {
        // Ollama format
        promptTokens = raw.prompt_eval_count;
        if (raw.eval_count !== undefined) {
            completionTokens = raw.eval_count;
        }
        totalTokens = promptTokens + completionTokens;
    }

    return {
        promptTokens,
        completionTokens,
        reasoningTokens,
        totalTokens: totalTokens || (promptTokens + completionTokens + reasoningTokens),
        costInUsd: 0, // Will be calculated separately
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
 * Format token usage for logging
 */
export const formatTokenUsage = (tokens: TokenUsage): string => {
    return `Tokens: ${tokens.totalTokens} (Prompt: ${tokens.promptTokens}, Completion: ${tokens.completionTokens}, Reasoning: ${tokens.reasoningTokens}) - Cost: $${tokens.costInUsd.toFixed(6)}`;
};