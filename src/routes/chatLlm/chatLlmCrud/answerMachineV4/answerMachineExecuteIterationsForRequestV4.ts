import mongoose from 'mongoose';

import { ModelAnswerMachineRequestV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV4.schema';

import executeIterationV4 from './executeIterationV4';
import tryFinalizeAnswerMachineV4Cancellation from './tryFinalizeAnswerMachineV4Cancellation';

export type AnswerMachineIterationsRunResult =
    | { kind: 'completed' }
    | { kind: 'cancelled' }
    | { kind: 'failed'; errorReason: string };

const isCancellationErrorReason = (reason: string): boolean =>
    reason === 'CancelledByUser' || reason === 'Cancelled';

/**
 * Runs AM4 outer iterations until answered, error, or max iterations.
 * Used by the dedicated AM4 cron worker (not the HTTP request path).
 */
const answerMachineExecuteIterationsForRequestV4 = async ({
    answerMachineRequestV4Id,
}: {
    answerMachineRequestV4Id: mongoose.Types.ObjectId;
}): Promise<AnswerMachineIterationsRunResult> => {
    const answerMachineRecord = await ModelAnswerMachineRequestV4.findById(answerMachineRequestV4Id);
    if (!answerMachineRecord) {
        return { kind: 'failed', errorReason: 'Answer Machine V4 request not found' };
    }

    if (answerMachineRecord.status === 'answered') {
        return { kind: 'completed' };
    }

    if (answerMachineRecord.status === 'error') {
        if (answerMachineRecord.errorReason === 'Cancelled by user') {
            return { kind: 'cancelled' };
        }
        return { kind: 'failed', errorReason: answerMachineRecord.errorReason || 'Prior error state' };
    }

    const maxIterations = answerMachineRecord.maxNumberOfIterations;
    for (let i = 1; i <= maxIterations; i++) {
        if (await tryFinalizeAnswerMachineV4Cancellation({ answerMachineRequestV4Id })) {
            return { kind: 'cancelled' };
        }

        const iterationResult = await executeIterationV4({
            answerMachineRequestV4Id,
        });

        if (!iterationResult.success) {
            if (isCancellationErrorReason(iterationResult.errorReason)) {
                return { kind: 'cancelled' };
            }
            await ModelAnswerMachineRequestV4.findByIdAndUpdate(answerMachineRequestV4Id, {
                $set: {
                    status: 'error',
                    errorReason: iterationResult.errorReason || 'Iteration failed',
                    updatedAt: new Date(),
                },
            });
            return { kind: 'failed', errorReason: iterationResult.errorReason || 'Iteration failed' };
        }

        const refreshed = await ModelAnswerMachineRequestV4.findById(answerMachineRequestV4Id);
        if (refreshed?.status === 'answered') {
            return { kind: 'completed' };
        }

        await ModelAnswerMachineRequestV4.findByIdAndUpdate(answerMachineRequestV4Id, {
            $set: {
                currentIteration: i + 1,
                updatedAt: new Date(),
            },
        });
    }

    const finalRow = await ModelAnswerMachineRequestV4.findById(answerMachineRequestV4Id);
    if (!finalRow) {
        return { kind: 'failed', errorReason: 'Answer Machine V4 request not found' };
    }
    if (finalRow.status === 'error' && finalRow.errorReason === 'Cancelled by user') {
        return { kind: 'cancelled' };
    }
    return finalRow.status !== 'error' ? { kind: 'completed' } : { kind: 'failed', errorReason: finalRow.errorReason || 'error' };
};

export default answerMachineExecuteIterationsForRequestV4;
