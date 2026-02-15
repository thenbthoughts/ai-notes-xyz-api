import mongoose from "mongoose";
import fetchLlmUnified, { Message } from "../../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { SubQuestionRepository } from "../database/sub-question-repository";
import { TokenRepository } from "../database/token-repository";
import { LlmConfigService } from "../config/llm-config-service";
import { AnswerMachineRepository } from "../database/answer-machine-repository";
import { extractTokensFromRawResponse, calculateCostInUsd, formatTokenUsage } from "../utils/token-calculator";
import { LlmRawResponse } from "../types/answer-machine.types";

/**
 * Service for generating final comprehensive answers
 */
export class FinalAnswerGenerator {

    /**
     * Generate a final comprehensive answer from sub-questions and conversation
     */
    static async generateFinalAnswer(
        threadId: mongoose.Types.ObjectId,
        username: string,
        answerMachineId: mongoose.Types.ObjectId
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
            console.log(`[Final Answer Generator] Generating final answer for thread ${threadId}`);

            // Get answer machine record to access threadId
            const answerMachineRecord = await AnswerMachineRepository.findById(answerMachineId);
            if (!answerMachineRecord) {
                return {
                    success: false,
                    errorReason: 'Answer machine record not found'
                };
            }

            // Get LLM configuration
            const llmConfig = await LlmConfigService.getLlmConfigForUser(username, answerMachineRecord.threadId?.toString());
            if (!llmConfig) {
                return {
                    success: false,
                    errorReason: 'No LLM configuration available'
                };
            }

            // Get conversation context
            const conversationMessages = await this.getConversationMessages(threadId, username);
            const conversationText = this.formatConversationMessages(conversationMessages);

            // Get answered sub-questions
            const answeredSubQuestions = await SubQuestionRepository.getAnsweredQuestionsForFinalAnswer(answerMachineId);
            const subQuestionsText = this.formatSubQuestionAnswers(answeredSubQuestions);

            // Get thread system prompt
            const thread = await ModelChatLlmThread.findById(threadId);
            const systemPrompt = thread?.systemPrompt || 'You are a helpful AI assistant.';

            // Build enhanced system prompt for final answer
            const finalAnswerSystemPrompt = `${systemPrompt}

You are synthesizing a comprehensive final answer based on research questions that were asked to gather information. Your task is to provide a complete, well-structured answer that directly addresses the original user question.

Instructions:
- Synthesize information from all the research questions and answers provided
- Provide a comprehensive but concise answer
- Structure your answer clearly with appropriate formatting
- Ensure the answer directly addresses the original question
- Use evidence from the research to support your answer
- If there are gaps or uncertainties, acknowledge them
- Maintain the same helpful tone as the system prompt above`;

            // Build user prompt
            let userPrompt = `Please provide a comprehensive final answer based on the following research and conversation context.\n\n`;

            if (conversationText) {
                userPrompt += `ORIGINAL CONVERSATION:\n${conversationText}\n\n`;
            }

            if (subQuestionsText) {
                userPrompt += `RESEARCH FINDINGS:\n${subQuestionsText}\n\n`;
            }

            userPrompt += `Based on all the above information, please provide a complete and well-structured answer to the user's original question.`;

            const messages: Message[] = [
                { role: 'system', content: finalAnswerSystemPrompt },
                { role: 'user', content: userPrompt },
            ];

            // Call LLM for final answer
            const llmResult = await fetchLlmUnified({
                provider: llmConfig.provider,
                apiKey: llmConfig.apiKey,
                apiEndpoint: llmConfig.apiEndpoint,
                model: llmConfig.model,
                messages,
                temperature: 0.4, // Slightly higher creativity for synthesis
                maxTokens: 2048, // Allow longer final answers
                headersExtra: llmConfig.customHeaders,
            });

            if (!llmResult.success || !llmResult.content) {
                return {
                    success: false,
                    errorReason: llmResult.error || 'Failed to generate final answer'
                };
            }

            // Extract token information
            const tokens = extractTokensFromRawResponse(llmResult.raw as LlmRawResponse);
            const costInUsd = calculateCostInUsd(tokens.promptTokens, tokens.completionTokens, tokens.reasoningTokens, llmConfig.model, llmConfig.provider);

            // Track tokens
            await TokenRepository.trackTokens(
                answerMachineId,
                threadId,
                { ...tokens, costInUsd },
                username,
                'final_answer'
            );

            const fullTokens = { ...tokens, costInUsd };
            console.log(`[Final Answer Generator] Successfully generated final answer`);
            console.log(formatTokenUsage(fullTokens));

            return {
                success: true,
                answer: llmResult.content.trim(),
                tokens: fullTokens,
            };

        } catch (error) {
            console.error(`[Final Answer Generator] Error generating final answer for thread ${threadId}:`, error);
            return {
                success: false,
                errorReason: error instanceof Error ? error.message : 'Final answer generation failed'
            };
        }
    }

    /**
     * Get conversation messages for context
     */
    private static async getConversationMessages(
        threadId: mongoose.Types.ObjectId,
        username: string
    ): Promise<IChatLlm[]> {
        try {
            // Get all conversation messages in chronological order
            const messages = await ModelChatLlm.find({
                threadId,
                username,
                type: 'text',
            }).sort({ createdAtUtc: 1 });

            return messages;
        } catch (error) {
            console.error('[Final Answer Generator] Error getting conversation messages:', error);
            return [];
        }
    }

    /**
     * Format conversation messages for LLM context
     */
    private static formatConversationMessages(messages: IChatLlm[]): string {
        if (messages.length === 0) {
            return '';
        }

        return messages
            .map((msg) => {
                const role = msg.isAi ? 'Assistant' : 'User';
                return `${role}: ${msg.content || ''}`;
            })
            .join('\n\n');
    }

    /**
     * Format sub-question answers for LLM context
     */
    private static formatSubQuestionAnswers(
        subQuestions: Array<{ question: string; answer: string }>
    ): string {
        if (subQuestions.length === 0) {
            return '';
        }

        return subQuestions
            .map((sq, index) => {
                return `Research Question ${index + 1}: ${sq.question}\nAnswer ${index + 1}: ${sq.answer}`;
            })
            .join('\n\n');
    }
}