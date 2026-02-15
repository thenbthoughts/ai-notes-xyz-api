import mongoose from "mongoose";
import { ModelChatLlmAnswerMachine } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema";
import { ModelAnswerMachineSubQuestion } from "../../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineSubQuestions.schema";
import { trackAnswerMachineTokens } from "../helperFunction/tokenTracking";
import AnswerSubQuestion from "../../answerMachine/utils/AnswerSubQuestion";

const step3AnswerSubQuestions = async ({
    answerMachineRecordId,
}: {
    answerMachineRecordId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: null;
}> => {
    try {
        console.log('step3AnswerSubQuestions', answerMachineRecordId);

        // Get the answer machine record to get thread info
        const answerMachineRecord = await ModelChatLlmAnswerMachine.findById(answerMachineRecordId);
        if (!answerMachineRecord) {
            return {
                success: false,
                errorReason: 'Answer machine record not found',
                data: null,
            };
        }

        // Find all pending sub-questions for this thread
        const pendingSubQuestions = await ModelAnswerMachineSubQuestion.find({
            threadId: answerMachineRecord.threadId,
            username: answerMachineRecord.username,
            status: 'pending',
        });

        console.log(`Found ${pendingSubQuestions.length} pending sub-questions`);

        if (pendingSubQuestions.length === 0) {
            console.log('No pending sub-questions to answer');
            return {
                success: true,
                errorReason: '',
                data: null,
            };
        }

        // Answer each sub-question
        const answerPromises = pendingSubQuestions.map(async (subQuestion) => {
            try {
                console.log(`Answering sub-question: ${subQuestion._id}`);

                const answerSubQuestion = new AnswerSubQuestion(subQuestion._id);
                const result = await answerSubQuestion.execute();

                if (!result.success) {
                    console.error(`Failed to answer sub-question ${subQuestion._id}:`, result.errorReason);

                    // Update sub-question status to error
                    await ModelAnswerMachineSubQuestion.findByIdAndUpdate(subQuestion._id, {
                        $set: {
                            status: 'error',
                            errorReason: result.errorReason || 'Failed to answer sub-question',
                        }
                    });

                    return { success: false, subQuestionId: subQuestion._id, error: result.errorReason };
                }

                // Update sub-question with answer and token data
                await ModelAnswerMachineSubQuestion.findByIdAndUpdate(subQuestion._id, {
                    $set: {
                        status: 'answered',
                        answer: result.answer,
                        contextIds: result.contextIds,
                        aiModelName: 'gpt-oss-20b', // Use the same model as in AnswerSubQuestion class
                        aiModelProvider: 'groq', // Default provider
                        promptTokens: result.tokens?.promptTokens || 0,
                        completionTokens: result.tokens?.completionTokens || 0,
                        reasoningTokens: result.tokens?.reasoningTokens || 0,
                        totalTokens: result.tokens?.totalTokens || 0,
                        costInUsd: result.tokens?.costInUsd || 0,
                    }
                });

                // Track tokens for answer machine
                if (result.tokens && subQuestion.threadId) {
                    await trackAnswerMachineTokens(
                        subQuestion.threadId,
                        result.tokens,
                        subQuestion.username,
                        'sub_question_answer'
                    );
                }

                console.log(`Successfully answered sub-question: ${subQuestion._id}`);
                return { success: true, subQuestionId: subQuestion._id };

            } catch (error) {
                console.error(`Error answering sub-question ${subQuestion._id}:`, error);

                // Update sub-question status to error
                await ModelAnswerMachineSubQuestion.findByIdAndUpdate(subQuestion._id, {
                    $set: {
                        status: 'error',
                        errorReason: error instanceof Error ? error.message : 'Unknown error',
                    }
                });

                return {
                    success: false,
                    subQuestionId: subQuestion._id,
                    error: error instanceof Error ? error.message : 'Unknown error'
                };
            }
        });

        // Wait for all sub-questions to be answered
        const results = await Promise.all(answerPromises);

        // Check if any failed
        const failedResults = results.filter(result => !result.success);
        if (failedResults.length > 0) {
            console.error(`Failed to answer ${failedResults.length} sub-questions`);
            return {
                success: false,
                errorReason: `Failed to answer ${failedResults.length} out of ${pendingSubQuestions.length} sub-questions`,
                data: null,
            };
        }

        console.log(`Successfully answered all ${pendingSubQuestions.length} sub-questions`);
        return {
            success: true,
            errorReason: '',
            data: null,
        };

    } catch (error) {
        console.error(`❌ Error in step3AnswerSubQuestions (answerMachineRecord ${answerMachineRecordId}):`, error);
        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
        return {
            success: false,
            errorReason: errorMessage,
            data: null,
        };
    }
};

export default step3AnswerSubQuestions;