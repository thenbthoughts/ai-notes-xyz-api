import mongoose from 'mongoose';

import { ModelAnswerMachineRequestV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV4.schema';

/** True if the row transitioned from pending (+ cancel flag) to error in this update. */
const tryFinalizeAnswerMachineV4Cancellation = async ({
    answerMachineRequestV4Id,
}: {
    answerMachineRequestV4Id: mongoose.Types.ObjectId;
}): Promise<boolean> => {
    const updated = await ModelAnswerMachineRequestV4.findOneAndUpdate(
        {
            _id: answerMachineRequestV4Id,
            status: 'pending',
            cancellationRequestedUtc: { $ne: null },
        },
        {
            $set: {
                status: 'error',
                errorReason: 'Cancelled by user',
                updatedAt: new Date(),
            },
        },
        { new: true },
    ).lean();

    return updated != null;
};

export default tryFinalizeAnswerMachineV4Cancellation;
