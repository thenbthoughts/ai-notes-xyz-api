import mongoose from "mongoose";
import { SubQuestionRepository } from "../database/sub-question-repository";
import { SubQuestionAnswerer } from "../services/sub-question-answerer";
import { TokenRepository } from "../database/token-repository";

/**
 * Step 3: Answer all pending sub-questions
 */
export const step3AnswerSubQuestions = async ({
    answerMachineId,
    threadId,
    username,
}: {
    answerMachineId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<void> => {
    try {
        // Get all pending sub-questions for this answer machine
        const pendingSubQuestions = await SubQuestionRepository.findPendingByAnswerMachineId(answerMachineId);

        if (pendingSubQuestions.length === 0) {
            return;
        }

        console.log(`🔄 Processing ${pendingSubQuestions.length} pending sub-questions`);

        // Process each sub-question
        for (const subQuestion of pendingSubQuestions) {
            try {
                // Answer the sub-question using the new service
                const result = await SubQuestionAnswerer.answerSubQuestion(subQuestion._id!, username);

                // The service already updates the database and tracks tokens
                // We just need to handle any additional logging or error handling

                if (!result.success) {
                    console.error(`[Answer Sub-Questions] Failed to answer sub-question ${subQuestion._id}: ${result.errorReason}`);
                }

            } catch (error) {
                const errorMsg = `Failed to process sub-question ${subQuestion._id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
                console.error(`[Answer Sub-Questions] ${errorMsg}`);

                // Update with error status if not already handled by the service
                try {
                    await SubQuestionRepository.updateWithError(
                        subQuestion._id!,
                        error instanceof Error ? error.message : 'Unknown error'
                    );
                } catch (updateError) {
                    console.error(`[Answer Sub-Questions] Failed to update error status for ${subQuestion._id}:`, updateError);
                }
            }
        }

        console.log(`✅ Completed processing sub-questions`);
    } catch (error) {
        const errorMsg = `Error in step3AnswerSubQuestions: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`[Answer Sub-Questions] ❌ ${errorMsg}`);
        // Don't throw - allow process to continue
    }
};