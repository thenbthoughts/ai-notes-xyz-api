import mongoose from "mongoose";

import { ModelChatLlmAnswerMachine } from "../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema";

import step2CreateQuestionDecomposition from "./step2CreateQuestionDecomposition/step2CreateQuestionDecomposition";
import step3AnswerSubQuestions from "./step3AnswerSubQuestions/step3AnswerSubQuestions";
import step4GenerateFinalAnswer from "./step4GenerateFinalAnswer/step4GenerateFinalAnswer";
import step5EvaluateAnswer from "./step5EvaluateAnswer/step5EvaluateAnswer";

// -----

const executeIteration = async ({
    answerMachineRecordId,
    abortSignal,
}: {
    answerMachineRecordId: mongoose.Types.ObjectId;
    abortSignal?: AbortSignal;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: null;
}> => {
    try {
        console.log('executeIteration', answerMachineRecordId);

        if (abortSignal?.aborted) {
            return {
                success: false,
                errorReason: 'Cancelled',
                data: null,
            };
        }

        // Step 1: Get the answer machine record
        const answerMachineRecord = await ModelChatLlmAnswerMachine.findById(answerMachineRecordId);
        console.log('answerMachineRecord', answerMachineRecord);
        console.log('answerMachineRecord', answerMachineRecord?.currentIteration);

        // Step 2: Generate the sub questions
        const resultSubQuestions = await step2CreateQuestionDecomposition({
            answerMachineRecordId,
            abortSignal,
        });
        if (resultSubQuestions.errorReason === 'Cancelled') {
            return {
                success: false,
                errorReason: 'Cancelled',
                data: null,
            };
        }
        if (resultSubQuestions.success === false) {
            return {
                success: false,
                errorReason: 'Failed to create sub questions',
                data: null,
            };
        }

        // Step 3: Answer the sub questions
        const resultAnswerSubQuestions = await step3AnswerSubQuestions({
            answerMachineRecordId,
            abortSignal,
        });
        if (resultAnswerSubQuestions.errorReason === 'Cancelled') {
            return {
                success: false,
                errorReason: 'Cancelled',
                data: null,
            };
        }
        if (resultAnswerSubQuestions.success === false) {
            return {
                success: false,
                errorReason: 'Failed to answer sub questions: ' + resultAnswerSubQuestions.errorReason,
                data: null,
            };
        }

        // Step 4: Generate the final answer
        const resultGenerateFinalAnswer = await step4GenerateFinalAnswer({
            answerMachineRecordId,
            abortSignal,
        });
        if (resultGenerateFinalAnswer.errorReason === 'Cancelled') {
            return {
                success: false,
                errorReason: 'Cancelled',
                data: null,
            };
        }
        if (resultGenerateFinalAnswer.success === false) {
            return {
                success: false,
                errorReason: 'Failed to generate final answer: ' + resultGenerateFinalAnswer.errorReason,
                data: null,
            };
        }

        // Step 5: Evaluate the answer and set the status to answered if satisfactory
        const resultEvaluateAnswer = await step5EvaluateAnswer({
            answerMachineRecordId,
            abortSignal,
        });
        if (resultEvaluateAnswer.errorReason === 'Cancelled') {
            return {
                success: false,
                errorReason: 'Cancelled',
                data: null,
            };
        }
        if (resultEvaluateAnswer.success === false) {
            return {
                success: false,
                errorReason: 'Failed to evaluate answer: ' + resultEvaluateAnswer.errorReason,
                data: null,
            };
        }

        return {
            success: true,
            errorReason: '',
            data: null,
        };
    } catch (error) {
        console.error(`❌ Error in executeIteration (answerMachineRecord ${answerMachineRecordId}):`, error);
        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
        return {
            success: false,
            errorReason: errorMessage,
            data: null,
        };
    }
}

export default executeIteration;