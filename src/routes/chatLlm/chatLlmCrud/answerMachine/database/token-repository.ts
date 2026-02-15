import mongoose from "mongoose";
import { ModelChatLlmAnswerMachineTokenRecord } from "../../../../../schema/schemaChatLlm/SchemaChatLlmAnswerMachineTokenRecord.schema";
import { AnswerMachineRepository } from "./answer-machine-repository";

/**
 * Repository for Token tracking operations
 */
export class TokenRepository {

    /**
     * Track tokens for answer machine operations
     */
    static async trackTokens(
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
    ): Promise<void> {
        try {
            if (queryType) {
                await AnswerMachineRepository.createTokenRecord({
                    answerMachineId,
                    threadId,
                    username,
                    queryType,
                    ...tokens,
                });
            }
        } catch (error) {
            console.error(`[Token Tracking] Error tracking tokens for thread ${threadId}:`, error);
        }
    }

    /**
     * Update answer machine with aggregated token totals
     */
    static async updateAggregatedTotals(answerMachineId: mongoose.Types.ObjectId): Promise<void> {
        try {
            const aggregatedTokens = await AnswerMachineRepository.getAggregatedTokens(answerMachineId);

            await AnswerMachineRepository.update(answerMachineId, {
                totalPromptTokens: aggregatedTokens.totalPromptTokens,
                totalCompletionTokens: aggregatedTokens.totalCompletionTokens,
                totalReasoningTokens: aggregatedTokens.totalReasoningTokens,
                totalTokens: aggregatedTokens.totalTokens,
                costInUsd: aggregatedTokens.totalCostInUsd,
            });
        } catch (error) {
            console.error(`[Token Repository] Error updating aggregated totals for ${answerMachineId}:`, error);
        }
    }

    /**
     * Get token breakdown by query type for an answer machine
     */
    static async getTokenBreakdownByType(
        answerMachineId: mongoose.Types.ObjectId
    ): Promise<Record<string, {
        count: number;
        totalTokens: number;
        totalCost: number;
        avgTokens: number;
        maxTokens: number;
    }>> {
        try {
            const result = await ModelChatLlmAnswerMachineTokenRecord.aggregate([
                { $match: { answerMachineId } },
                {
                    $group: {
                        _id: '$queryType',
                        count: { $sum: 1 },
                        totalTokens: { $sum: '$totalTokens' },
                        totalCost: { $sum: '$costInUsd' },
                        maxTokens: { $max: '$totalTokens' },
                    }
                }
            ]);

            const breakdown: Record<string, any> = {};

            result.forEach(item => {
                breakdown[item._id] = {
                    count: item.count,
                    totalTokens: item.totalTokens,
                    totalCost: item.totalCost,
                    avgTokens: Math.round(item.totalTokens / item.count),
                    maxTokens: item.maxTokens,
                };
            });

            return breakdown;
        } catch (error) {
            console.error(`[Token Repository] Error getting breakdown for ${answerMachineId}:`, error);
            return {};
        }
    }
}