import mongoose from 'mongoose';

/**
 * Legacy hook: Answer Machine V3 now plans steps inside `runSequentialReasoningLoop`.
 * Kept so imports in older branches or tooling do not break.
 */
const step2CreateQuestionDecomposition = async (_args: {
    answerMachineRequestV3Id: mongoose.Types.ObjectId;
    abortSignal?: AbortSignal;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: null;
}> => {
    return { success: true, errorReason: '', data: null };
};

export default step2CreateQuestionDecomposition;
