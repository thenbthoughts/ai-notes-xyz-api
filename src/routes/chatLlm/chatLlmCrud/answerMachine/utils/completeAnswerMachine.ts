import mongoose from "mongoose";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelAnswerMachineSubQuestion } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";
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
        // Check if there are any answered sub-questions
        const answeredSubQuestions = await ModelAnswerMachineSubQuestion.find({
            threadId,
            username,
            status: 'answered',
        });

        // Only generate final answer if there are answered sub-questions
        if (answeredSubQuestions.length === 0) {
            console.log(`[Complete] No answered sub-questions found, skipping final answer generation`);
            // Still mark as answered even if no sub-questions
            await ModelChatLlmThread.findByIdAndUpdate(threadId, {
                $set: {
                    answerMachineStatus: 'answered',
                }
            });
            return;
        }

        // Generate final answer and create message
        const generateFinalAnswer = new GenerateFinalAnswer(threadId, username);
        const result = await generateFinalAnswer.execute();

        if (result.success) {
            console.log(`[Complete] Final answer generated successfully, messageId: ${result.messageId}`);
        } else {
            console.error(`[Complete] Failed to generate final answer: ${result.errorReason}`);
        }

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
                    answerMachineErrorReason: error instanceof Error ? error.message : 'Error completing answer machine',
                }
            });
        } catch (updateError) {
            console.error(`[Complete] Failed to update thread status:`, updateError);
        }
    }
};

export default completeAnswerMachine;
