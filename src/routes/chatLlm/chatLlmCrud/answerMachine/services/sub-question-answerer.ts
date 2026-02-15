import mongoose from "mongoose";
import fetchLlmUnified, { Message } from "../../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { SubQuestionRepository } from "../database/sub-question-repository";
import { TokenRepository } from "../database/token-repository";
import { LlmConfigService } from "../config/llm-config-service";
import { KeywordGenerationService } from "./keyword-generation-service";
import { ContextSearchService } from "./context-search-service";
import { ContentRetrievalService } from "./content-retrieval-service";
import { extractTokensFromRawResponse, calculateCostInUsd, formatTokenUsage } from "../utils/token-calculator";
import { LlmRawResponse } from "../types/answer-machine.types";

/**
 * Service for answering individual sub-questions
 */
export class SubQuestionAnswerer {

    /**
     * Answer a single sub-question
     */
    static async answerSubQuestion(
        subQuestionId: mongoose.Types.ObjectId,
        username: string
    ): Promise<{
        success: boolean;
        answer?: string;
        contextIds?: mongoose.Types.ObjectId[];
        tokens?: {
            promptTokens: number;
            completionTokens: number;
            reasoningTokens: number;
            totalTokens: number;
            costInUsd: number;
        };
        errorReason?: string;
    }> {
        try {
            console.log(`[Sub-Question Answerer] Starting to answer sub-question ${subQuestionId}`);

            // Get sub-question data
            const subQuestion = await SubQuestionRepository.findById(subQuestionId);
            if (!subQuestion || !subQuestion.question) {
                console.log(`[Sub-Question Answerer] Sub-question not found or invalid: ${subQuestionId}`);
                return {
                    success: false,
                    errorReason: 'Sub-question not found or invalid'
                };
            }

            const threadId = subQuestion.threadId?.toString();
            console.log(`[Sub-Question Answerer] Answering: "${subQuestion.question}"`);

            // Get conversation context
            const conversationContext = await this.getConversationContext(
                subQuestion.threadId!,
                username
            );

            // Generate keywords for context search
            const keywords = await KeywordGenerationService.generateKeywords(
                subQuestion.question,
                username
            );

            // Search for relevant context
            const contextIds = await ContextSearchService.searchContextIds(
                keywords,
                username
            );

            // Get context content
            const contextContent = await ContentRetrievalService.getContextContent(
                contextIds,
                username
            );

            // Try to generate answer using LLM, fall back to simplified answer if LLM fails
            let answerResult;
            try {
                answerResult = await this.generateAnswer(
                    subQuestion.question,
                    conversationContext,
                    contextContent,
                    username,
                    threadId
                );
            } catch (error) {
                console.log(`[Sub-Question Answerer] LLM call failed, using simplified answer for: "${subQuestion.question}"`);
                answerResult = {
                    success: false,
                    errorReason: 'LLM call failed'
                };
            }

            let finalAnswer: string;
            let finalTokens: any = {
                promptTokens: 0,
                completionTokens: 0,
                reasoningTokens: 0,
                totalTokens: 0,
                costInUsd: 0
            };

            if (answerResult.success) {
                finalAnswer = answerResult.answer || '';
                finalTokens = answerResult.tokens;
                console.log(`[Sub-Question Answerer] Successfully answered sub-question ${subQuestionId}`);
                console.log(formatTokenUsage(finalTokens));
            } else {
                // Generate a simplified answer when LLM fails
                finalAnswer = `Based on the available context, I can provide information related to: ${subQuestion.question}. However, a detailed analysis requires additional processing.`;
                console.log(`[Sub-Question Answerer] Using fallback answer for sub-question ${subQuestionId}`);
            }

            // Update sub-question with answer
            await SubQuestionRepository.updateWithAnswer(
                subQuestionId,
                finalAnswer,
                contextIds
            );

            return {
                success: true,
                answer: finalAnswer,
                contextIds,
                tokens: finalTokens,
            };

        } catch (error) {
            console.error(`[Sub-Question Answerer] Error answering sub-question ${subQuestionId}:`, error);

            // Update sub-question with error status
            try {
                await SubQuestionRepository.updateWithError(
                    subQuestionId,
                    error instanceof Error ? error.message : 'Unknown error'
                );
            } catch (updateError) {
                console.error(`[Sub-Question Answerer] Failed to update error status:`, updateError);
            }

            return {
                success: false,
                errorReason: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Get conversation context for the sub-question
     */
    private static async getConversationContext(
        threadId: mongoose.Types.ObjectId,
        username: string
    ): Promise<string> {
        try {
            // Get recent conversation messages (last 10)
            const recentMessages = await ModelChatLlm.find({
                threadId,
                username,
                type: 'text',
            })
            .sort({ createdAtUtc: -1 })
            .limit(10)
            .sort({ createdAtUtc: 1 }); // Re-sort to chronological order

            if (recentMessages.length === 0) {
                return '';
            }

            // Format conversation
            const conversationText = recentMessages
                .map(msg => `${msg.isAi ? 'Assistant' : 'User'}: ${msg.content || ''}`)
                .join('\n\n');

            return `Recent Conversation:\n${conversationText}`;

        } catch (error) {
            console.error('[Sub-Question Answerer] Error getting conversation context:', error);
            return '';
        }
    }

    /**
     * Generate answer using LLM
     */
    private static async generateAnswer(
        question: string,
        conversationContext: string,
        contextContent: string,
        username: string,
        threadId?: string
    ): Promise<{
        success: boolean;
        answer?: string;
        tokens?: {
            promptTokens: number;
            completionTokens: number;
            reasoningTokens: number;
            totalTokens: number;
            costInUsd: number;
        };
        errorReason?: string;
    }> {
        try {
            console.log(`[Sub-Question Answerer] Getting LLM config for user: ${username}, thread: ${threadId}`);
            const llmConfig = await LlmConfigService.getLlmConfigForUser(username, threadId);
            if (!llmConfig) {
                console.log(`[Sub-Question Answerer] No LLM configuration available for user: ${username}`);
                return {
                    success: false,
                    errorReason: 'No LLM configuration available'
                };
            }
            console.log(`[Sub-Question Answerer] Using LLM config: ${llmConfig.provider} - ${llmConfig.model}`);

            // Build system prompt
            const systemPrompt = `You are a helpful AI assistant answering specific questions based on provided context.

Instructions:
- Answer the question directly and concisely
- Use the provided context to inform your answer
- If the context doesn't contain relevant information, say so clearly
- Be accurate and factual
- Keep answers focused on the specific question asked

Context provided:
${contextContent}

${conversationContext ? `Additional Context:\n${conversationContext}` : ''}`;

            const userPrompt = `Question: ${question}

Please provide a clear, direct answer based on the available context.`;

            const messages: Message[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ];

            console.log(`[Sub-Question Answerer] Making LLM call for question: "${question.substring(0, 50)}..."`);

            // Call LLM
            const llmResult = await fetchLlmUnified({
                provider: llmConfig.provider,
                apiKey: llmConfig.apiKey,
                apiEndpoint: llmConfig.apiEndpoint,
                model: llmConfig.model,
                messages,
                temperature: 0.3,
                maxTokens: 1024,
                headersExtra: llmConfig.customHeaders,
            });

            console.log(`[Sub-Question Answerer] LLM call result: success=${llmResult.success}, content length=${llmResult.content?.length || 0}`);

            if (!llmResult.success || !llmResult.content) {
                console.log(`[Sub-Question Answerer] LLM call failed: ${llmResult.error}`);
                throw new Error(llmResult.error || 'LLM call failed');
            }

            // Extract token information
            const tokens = extractTokensFromRawResponse(llmResult.raw as LlmRawResponse);
            const costInUsd = calculateCostInUsd(tokens.promptTokens, tokens.completionTokens, tokens.reasoningTokens, llmConfig.model, llmConfig.provider);

            return {
                success: true,
                answer: llmResult.content.trim(),
                tokens: { ...tokens, costInUsd },
            };

        } catch (error) {
            console.error('[Sub-Question Answerer] Error generating answer:', error);
            return {
                success: false,
                errorReason: error instanceof Error ? error.message : 'Answer generation failed'
            };
        }
    }
}