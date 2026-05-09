import mongoose from 'mongoose';



import { ModelAnswerMachineRequestV3 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV3.schema';
import { ModelAnswerMachinePipelineVisualV3 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachinePipelineVisualV3.schema';



import runSequentialReasoningLoop from './runSequentialReasoningLoop';

import step4GenerateFinalAnswer from './step4GenerateFinalAnswer/step4GenerateFinalAnswer';

import step5EvaluateAnswer from './step5EvaluateAnswer/step5EvaluateAnswer';



const executeIteration = async ({

    answerMachineRequestV3Id,

    abortSignal,

}: {

    answerMachineRequestV3Id: mongoose.Types.ObjectId;

    abortSignal?: AbortSignal;

}): Promise<{ success: boolean; errorReason: string; data: null }> => {

    try {

        if (abortSignal?.aborted) {

            return { success: false, errorReason: 'Cancelled', data: null };

        }



        const answerMachineRecord = await ModelAnswerMachineRequestV3.findById(answerMachineRequestV3Id);

        if (!answerMachineRecord) {

            return { success: false, errorReason: 'Answer Machine V3 request not found', data: null };

        }

        await ModelAnswerMachinePipelineVisualV3.findOneAndUpdate(
            {
                answerMachineRequestV3Id: answerMachineRecord._id,
                answerMachineIteration: answerMachineRecord.currentIteration,
            },
            {
                $setOnInsert: {
                    threadId: answerMachineRecord.threadId,
                    username: answerMachineRecord.username,
                    inputImageStoredFileUrl: '',
                    outputImageStoredFileUrl: '',
                    schemaVersion: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            },
            { upsert: true }
        );

        const resultReasoning = await runSequentialReasoningLoop({

            answerMachineRequestV3Id,

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



        const resultGenerateFinalAnswer = await step4GenerateFinalAnswer({

            answerMachineRequestV3Id,

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



        const resultEvaluateAnswer = await step5EvaluateAnswer({

            answerMachineRequestV3Id,

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

        console.error(`❌ executeIteration AM3 (${answerMachineRequestV3Id}):`, error);

        return {

            success: false,

            errorReason: error instanceof Error ? error.message : 'Internal server error',

            data: null,

        };

    }

};



export default executeIteration;

