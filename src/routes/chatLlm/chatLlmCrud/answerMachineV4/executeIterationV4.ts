import mongoose from 'mongoose';

import { ModelAnswerMachineRequestV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV4.schema';

import runSequentialReasoningLoopV4 from './runSequentialReasoningLoopV4';
import step4GenerateFinalAnswerV4 from './step4GenerateFinalAnswer/step4GenerateFinalAnswerV4';
import step5EvaluateAnswerV4 from './step5EvaluateAnswer/step5EvaluateAnswerV4';

const executeIterationV4 = async ({
    answerMachineRequestV4Id,
    abortSignal,
}: {
    answerMachineRequestV4Id: mongoose.Types.ObjectId;
    abortSignal?: AbortSignal;
}): Promise<{ success: boolean; errorReason: string; data: null }> => {
    try {
        if (abortSignal?.aborted) {
            return { success: false, errorReason: 'Cancelled', data: null };
        }

        const answerMachineRecord = await ModelAnswerMachineRequestV4.findById(answerMachineRequestV4Id);
        if (!answerMachineRecord) {
            return { success: false, errorReason: 'Answer Machine V4 request not found', data: null };
        }

        const resultReasoning = await runSequentialReasoningLoopV4({
            answerMachineRequestV4Id,
            abortSignal,
        });

        if (resultReasoning.errorReason === 'Cancelled') {
            return { success: false, errorReason: 'Cancelled', data: null };
        }
        if (!resultReasoning.success) {
            return {
                success: false,
                errorReason: resultReasoning.errorReason || 'sequential reasoning failed',
                data: null,
            };
        }

        const resultGenerateFinalAnswer = await step4GenerateFinalAnswerV4({
            answerMachineRequestV4Id,
            abortSignal,
        });

        if (resultGenerateFinalAnswer.errorReason === 'Cancelled') {
            return { success: false, errorReason: 'Cancelled', data: null };
        }
        if (!resultGenerateFinalAnswer.success) {
            return {
                success: false,
                errorReason: resultGenerateFinalAnswer.errorReason || 'step4 failed',
                data: null,
            };
        }

        const resultEvaluateAnswer = await step5EvaluateAnswerV4({
            answerMachineRequestV4Id,
            abortSignal,
        });

        if (resultEvaluateAnswer.errorReason === 'Cancelled') {
            return { success: false, errorReason: 'Cancelled', data: null };
        }
        if (!resultEvaluateAnswer.success) {
            return {
                success: false,
                errorReason: resultEvaluateAnswer.errorReason || 'step5 failed',
                data: null,
            };
        }

        return { success: true, errorReason: '', data: null };
    } catch (error) {
        console.error(`❌ executeIterationV4 AM4 (${answerMachineRequestV4Id}):`, error);
        return {
            success: false,
            errorReason: error instanceof Error ? error.message : 'Internal server error',
            data: null,
        };
    }
};

export default executeIterationV4;
