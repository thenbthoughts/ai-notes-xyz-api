import mongoose from 'mongoose';

import { ModelAnswerMachineRequestV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV4.schema';
import { ModelLlmPendingTaskCron } from '../../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../../../utils/llmPendingTask/llmPendingTaskConstants';

import answerMachineExecuteIterationsForRequestV4 from './answerMachineExecuteIterationsForRequestV4';

/** Runs queued AM4 work for one `answerMachineRequestV4` row (must be `status: pending`). */
const answerMachineCronProcessPendingRequest = async ({
    answerMachineRequestV4Id,
}: {
    answerMachineRequestV4Id: mongoose.Types.ObjectId;
}): Promise<void> => {
    const row = await ModelAnswerMachineRequestV4.findById(answerMachineRequestV4Id)
        .select('username threadId status')
        .lean();

    if (!row) {
        console.warn(`answerMachineCronProcessPendingRequest: AM4 doc not found ${answerMachineRequestV4Id}`);
        return;
    }
    if (row.status !== 'pending') {
        return;
    }

    const outcome = await answerMachineExecuteIterationsForRequestV4({
        answerMachineRequestV4Id,
    });

    if (outcome.kind === 'completed' && row.threadId) {
        await ModelLlmPendingTaskCron.create({
            username: row.username,
            taskType: llmPendingTaskTypes.page.featureAiActions.chatThread,
            targetRecordId: row.threadId,
        });
    }
};

export default answerMachineCronProcessPendingRequest;
