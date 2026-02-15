import mongoose from "mongoose";

import { ModelChatLlmAnswerMachine } from "../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaChatLlmAnswerMachine.schema";

// -----

const executeIteration = async ({
    answerMachineRecordId,
}: {
    answerMachineRecordId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: null;
}> => {
    try {
        console.log('executeIteration', answerMachineRecordId);

        // Step 1: Get the answer machine record
        const answerMachineRecord = await ModelChatLlmAnswerMachine.findById(answerMachineRecordId);
        console.log('answerMachineRecord', answerMachineRecord);
        console.log('answerMachineRecord', answerMachineRecord?.currentIteration);

        // Step 2: Generate the sub questions
        // const executeSubQuestions = await step2CreateQuestionDecomposition({
        //     answerMachineRecordId,
        // });
        // if(executeSubQuestions === false) {
        //     return {
        //         success: false,
        //         errorReason: 'Failed to create sub questions',
        //         data: null,
        //     };
        // }

        // Step 3: Answer the sub questions

        // Step 4: Generate the final answer

        // Step 5: Evaluate the answer and if evaluation is satisfactory, set the isSatisfactoryFinalAnswer to true


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