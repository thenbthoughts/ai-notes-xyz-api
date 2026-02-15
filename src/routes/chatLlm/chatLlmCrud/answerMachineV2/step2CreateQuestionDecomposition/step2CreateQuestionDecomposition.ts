import mongoose from "mongoose";

const step2CreateQuestionDecomposition = async ({
    answerMachineRecordId,
}: {
    answerMachineRecordId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: null;
}> => {
    try {
        return {
            success: true,
            errorReason: '',
            data: null,
        };
    } catch (error) {
        console.error(`❌ Error in step2CreateQuestionDecomposition (answerMachineRecord ${answerMachineRecordId}):`, error);
        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
        return {
            success: false,
            errorReason: errorMessage,
            data: null,
        };
    }
};

export default step2CreateQuestionDecomposition;