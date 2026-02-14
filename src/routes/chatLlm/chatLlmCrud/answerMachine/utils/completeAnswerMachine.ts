import mongoose from "mongoose";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelAnswerMachineSubQuestion } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";
import { ModelChatLlmAnswerMachine } from "../../../../../schema/schemaChatLlm/SchemaChatLlmAnswerMachine.schema";
import { ModelChatLlmAnswerMachineStats } from "../../../../../schema/schemaChatLlm/SchemaChatLlmAnswerMachineStats.schema";
import { ModelChatLlmAnswerMachineTokenRecord } from "../../../../../schema/schemaChatLlm/SchemaChatLlmAnswerMachineTokenRecord.schema";
import GenerateFinalAnswer from "./GenerateFinalAnswer";

/**
 * Complete the answer machine process by generating final answer and marking thread as answered.
 * This centralizes all completion logic to eliminate code duplication.
 */
const completeAnswerMachine = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<void> => {
    try {
        // Get thread to find answerMachineId
        const thread = await ModelChatLlmThread.findById(threadId);
        if (!thread || !thread.answerMachineId) {
            console.error(`[Complete] No answer machine ID found for thread ${threadId}`);
            return;
        }
        const answerMachineId = thread.answerMachineId;

        // Check if there are any answered sub-questions
        const answeredSubQuestions = await ModelAnswerMachineSubQuestion.find({
            answerMachineId,
            status: 'answered',
        });

        // Get token records for final aggregation
        const tokenRecords = await ModelChatLlmAnswerMachineTokenRecord.find({ answerMachineId });

        // Aggregate final token totals
        const finalTotals = tokenRecords.reduce(
            (acc, record) => ({
                promptTokens: acc.promptTokens + (record.promptTokens || 0),
                completionTokens: acc.completionTokens + (record.completionTokens || 0),
                reasoningTokens: acc.reasoningTokens + (record.reasoningTokens || 0),
                totalTokens: acc.totalTokens + (record.totalTokens || 0),
                costInUsd: acc.costInUsd + (record.costInUsd || 0),
            }),
            { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, costInUsd: 0 }
        );

        // Aggregate token breakdown by query type
        const tokenBreakdown: any = {};
        tokenRecords.forEach(record => {
            const type = record.queryType;
            if (type) {
                if (!tokenBreakdown[type]) {
                    tokenBreakdown[type] = {
                        promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, costInUsd: 0, count: 0, maxSingleQueryTokens: 0
                    };
                }
                tokenBreakdown[type].promptTokens += record.promptTokens || 0;
                tokenBreakdown[type].completionTokens += record.completionTokens || 0;
                tokenBreakdown[type].reasoningTokens += record.reasoningTokens || 0;
                tokenBreakdown[type].totalTokens += record.totalTokens || 0;
                tokenBreakdown[type].costInUsd += record.costInUsd || 0;
                tokenBreakdown[type].count += 1;
                const recordTotal = record.totalTokens || 0;
                if (recordTotal > tokenBreakdown[type].maxSingleQueryTokens) {
                    tokenBreakdown[type].maxSingleQueryTokens = recordTotal;
                }
            }
        });

        let finalAnswerText = '';
        let status: 'answered' | 'error' = 'answered';

        // Generate final answer if there are answered sub-questions
        if (answeredSubQuestions.length > 0) {
            const generateFinalAnswer = new GenerateFinalAnswer(threadId, username);
            const result = await generateFinalAnswer.execute();

            if (result.success) {
                console.log(`[Complete] Final answer generated successfully, messageId: ${result.messageId}`);
                finalAnswerText = result.finalAnswer || '';
            } else {
                console.error(`[Complete] Failed to generate final answer: ${result.errorReason}`);
                status = 'error';
                finalAnswerText = `Error generating final answer: ${result.errorReason}`;
            }
        } else {
            console.log(`[Complete] No answered sub-questions found, skipping final answer generation`);
        }

        // Update answer machine record with final state
        await ModelChatLlmAnswerMachine.findByIdAndUpdate(answerMachineId, {
            $set: {
                status,
                finalAnswer: finalAnswerText,
                totalPromptTokens: finalTotals.promptTokens,
                totalCompletionTokens: finalTotals.completionTokens,
                totalReasoningTokens: finalTotals.reasoningTokens,
                totalTokens: finalTotals.totalTokens,
                costInUsd: finalTotals.costInUsd,
                updatedAtUtc: new Date(),
            }
        });

        // Get answer machine record for parentMessageId
        const answerMachineRecordForStats = await ModelChatLlmAnswerMachine.findById(answerMachineId);

        // Create stats record
        await ModelChatLlmAnswerMachineStats.create({
            answerMachineId,
            threadId,
            parentMessageId: answerMachineRecordForStats?.parentMessageId || null,
            username,
            subQuestionsCount: answeredSubQuestions.length,
            intermediateAnswersCount: answerMachineRecordForStats?.intermediateAnswers?.length || 0,
            finalAnswer: finalAnswerText,
            tokenBreakdown,
            totalPromptTokens: finalTotals.promptTokens,
            totalCompletionTokens: finalTotals.completionTokens,
            totalReasoningTokens: finalTotals.reasoningTokens,
            totalTokens: finalTotals.totalTokens,
            costInUsd: finalTotals.costInUsd,
            status,
        });

        // Mark thread as answered
        await ModelChatLlmThread.findByIdAndUpdate(threadId, {
            $set: {
                answerMachineStatus: 'answered',
            }
        });

        console.log(`[Complete] Thread ${threadId} marked as answered`);
    } catch (error) {
        console.error(`[Complete] Error completing answer machine for thread ${threadId}:`, error);
        // Still mark as answered even if there was an error generating the answer
        // This prevents the thread from being stuck in pending state
        try {
            await ModelChatLlmThread.findByIdAndUpdate(threadId, {
                $set: {
                    answerMachineStatus: 'answered',
                }
            });
        } catch (updateError) {
            console.error(`[Complete] Failed to update thread status:`, updateError);
        }
    }
};

export default completeAnswerMachine;
