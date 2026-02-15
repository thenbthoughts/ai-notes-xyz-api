import mongoose from "mongoose";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { AnswerMachineRepository } from "../database/answer-machine-repository";

/**
 * Completion handler for answer machine runs
 */

/**
 * Complete an answer machine run
 */
export const completeAnswerMachine = async (
    threadId: mongoose.Types.ObjectId,
    username: string
): Promise<void> => {
    try {
        console.log(`[Completion] Completing answer machine run for thread ${threadId}`);

        // Update answer machine status to answered
        const thread = await mongoose.model('chatLlmThread').findById(threadId);
        console.log(`[Completion] Thread found: ${!!thread}, has answerMachineId: ${!!thread?.answerMachineId}`);
        if (thread?.answerMachineId) {
            console.log(`[Completion] Updating Answer Machine ${thread.answerMachineId} status to 'answered'`);
            await AnswerMachineRepository.update(thread.answerMachineId, {
                status: 'answered',
            });
            console.log(`[Completion] Successfully updated Answer Machine status`);
        }

        // Update thread status if needed
        // (Currently no thread-level status updates needed)

        console.log(`[Completion] Successfully completed answer machine run for thread ${threadId}`);
    } catch (error) {
        console.error(`[Completion] Error completing answer machine run for thread ${threadId}:`, error);

        // Mark as error status
        try {
            const thread = await ModelChatLlmThread.findById(threadId);
            if (thread?.answerMachineId) {
                await AnswerMachineRepository.update(thread.answerMachineId, {
                    status: 'error',
                });
            }
        } catch (updateError) {
            console.error(`[Completion] Failed to update error status:`, updateError);
        }
    }
};

/**
 * Create final answer message in conversation
 */
export const createFinalAnswerMessage = async (
    threadId: mongoose.Types.ObjectId,
    username: string,
    finalAnswer: string
): Promise<void> => {
    try {
        // Create the final answer message in the chat
        await ModelChatLlm.create({
            threadId,
            username,
            content: finalAnswer,
            type: 'text',
            isAi: true,
            createdAtUtc: new Date(),
        });

        console.log(`[Completion] Created final answer message in conversation for thread ${threadId}`);
    } catch (error) {
        console.error(`[Completion] Error creating final answer message for thread ${threadId}:`, error);
    }
};

/**
 * Generate completion summary for logging
 */
export const generateCompletionSummary = (
    answerMachineId: mongoose.Types.ObjectId,
    totalIterations: number,
    finalAnswer: string
): string => {
    const summary = `
Answer Machine Completion Summary:
- Answer Machine ID: ${answerMachineId}
- Total Iterations: ${totalIterations}
- Final Answer Length: ${finalAnswer.length} characters
- Completion Time: ${new Date().toISOString()}
    `.trim();

    return summary;
};