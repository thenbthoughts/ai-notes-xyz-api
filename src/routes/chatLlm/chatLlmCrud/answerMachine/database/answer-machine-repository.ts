import mongoose from "mongoose";
import { ModelChatLlmAnswerMachine } from "../../../../../schema/schemaChatLlm/SchemaChatLlmAnswerMachine.schema";
import { ModelChatLlmAnswerMachineTokenRecord } from "../../../../../schema/schemaChatLlm/SchemaChatLlmAnswerMachineTokenRecord.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";

export interface AnswerMachineRecord {
    threadId: mongoose.Types.ObjectId;
    parentMessageId: mongoose.Types.ObjectId;
    username: string;
    status: 'pending' | 'answered' | 'error';
    currentIteration: number;
    intermediateAnswers: string[];
    finalAnswer: string;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalReasoningTokens: number;
    totalTokens: number;
    costInUsd: number;
    createdAtUtc: Date;
    updatedAtUtc: Date;
}

export interface TokenRecord {
    answerMachineId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;
    queryType: 'question_generation' | 'sub_question_answer' | 'intermediate_answer' | 'evaluation' | 'final_answer';
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    costInUsd: number;
}

/**
 * Repository for Answer Machine database operations
 */
export class AnswerMachineRepository {

    /**
     * Create a new answer machine record
     */
    static async create(record: Omit<AnswerMachineRecord, 'createdAtUtc' | 'updatedAtUtc'>): Promise<mongoose.Types.ObjectId> {
        const answerMachineRecord = await ModelChatLlmAnswerMachine.create({
            ...record,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });

        return answerMachineRecord._id;
    }

    /**
     * Find answer machine by ID
     */
    static async findById(id: mongoose.Types.ObjectId): Promise<AnswerMachineRecord | null> {
        return await ModelChatLlmAnswerMachine.findById(id);
    }

    /**
     * Update answer machine record
     */
    static async update(
        id: mongoose.Types.ObjectId,
        updates: Partial<Omit<AnswerMachineRecord, '_id' | 'createdAtUtc'>>
    ): Promise<void> {
        await ModelChatLlmAnswerMachine.findByIdAndUpdate(id, {
            $set: { ...updates, updatedAtUtc: new Date() }
        });
    }

    /**
     * Find answer machines by thread ID
     */
    static async findByThreadId(threadId: mongoose.Types.ObjectId): Promise<AnswerMachineRecord[]> {
        return await ModelChatLlmAnswerMachine.find({ threadId }).sort({ createdAtUtc: -1 });
    }

    /**
     * Create token record
     */
    static async createTokenRecord(record: TokenRecord): Promise<void> {
        await ModelChatLlmAnswerMachineTokenRecord.create({
            ...record,
            createdAtUtc: new Date(),
        });
    }

    /**
     * Get aggregated token usage for answer machine
     */
    static async getAggregatedTokens(answerMachineId: mongoose.Types.ObjectId): Promise<{
        totalPromptTokens: number;
        totalCompletionTokens: number;
        totalReasoningTokens: number;
        totalTokens: number;
        totalCostInUsd: number;
    }> {
        const result = await ModelChatLlmAnswerMachineTokenRecord.aggregate([
            { $match: { answerMachineId } },
            {
                $group: {
                    _id: null,
                    totalPromptTokens: { $sum: '$promptTokens' },
                    totalCompletionTokens: { $sum: '$completionTokens' },
                    totalReasoningTokens: { $sum: '$reasoningTokens' },
                    totalTokens: { $sum: '$totalTokens' },
                    totalCostInUsd: { $sum: '$costInUsd' },
                }
            }
        ]);

        if (result.length === 0) {
            return {
                totalPromptTokens: 0,
                totalCompletionTokens: 0,
                totalReasoningTokens: 0,
                totalTokens: 0,
                totalCostInUsd: 0,
            };
        }

        return result[0];
    }

    /**
     * Initialize new run - reset previous state and create new record
     */
    static async initializeNewRun(
        threadId: mongoose.Types.ObjectId,
        username: string
    ): Promise<{
        success: boolean;
        answerMachineId?: mongoose.Types.ObjectId;
        errorReason?: string;
    }> {
        try {
            // Reset any previous run state for this thread
            const thread = await ModelChatLlmThread.findById(threadId);
            if (!thread) {
                return { success: false, errorReason: 'Thread not found' };
            }

            if (thread.answerMachineId) {
                // Clear thread answer machine reference
                await ModelChatLlmThread.findByIdAndUpdate(threadId, {
                    $set: { answerMachineId: null }
                });
            }

            // Get the last user message
            const lastUserMessage = await ModelChatLlm.findOne({
                threadId,
                username,
                isAi: false,
            }).sort({ createdAtUtc: -1 });

            if (!lastUserMessage) {
                return { success: false, errorReason: 'No user message found' };
            }

            // Create new answer machine record
            const answerMachineId = await this.create({
                threadId,
                parentMessageId: lastUserMessage._id,
                username,
                status: 'pending',
                currentIteration: 1,
                intermediateAnswers: [],
                finalAnswer: '',
                totalPromptTokens: 0,
                totalCompletionTokens: 0,
                totalReasoningTokens: 0,
                totalTokens: 0,
                costInUsd: 0,
            });

            // Update thread with answerMachineId
            await ModelChatLlmThread.findByIdAndUpdate(threadId, {
                $set: { answerMachineId }
            });

            return { success: true, answerMachineId };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to initialize run';
            console.error('❌ Error initializing new run:', errorMessage);
            return { success: false, errorReason: errorMessage };
        }
    }

    /**
     * Get continuation info for existing run
     */
    static async getContinuationInfo(
        threadId: mongoose.Types.ObjectId
    ): Promise<{
        answerMachineId: mongoose.Types.ObjectId;
        currentIteration: number;
    } | null> {
        const thread = await ModelChatLlmThread.findById(threadId);
        if (!thread?.answerMachineId) {
            return null;
        }

        const existingRecord = await this.findById(thread.answerMachineId);
        if (existingRecord) {
            return {
                answerMachineId: thread.answerMachineId,
                currentIteration: existingRecord.currentIteration || 1,
            };
        }

        return null;
    }
}