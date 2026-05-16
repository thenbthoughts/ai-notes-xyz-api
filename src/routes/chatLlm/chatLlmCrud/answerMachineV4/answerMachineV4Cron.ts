import mongoose from 'mongoose';

import { ModelAnswerMachineRequestV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV4.schema';

import answerMachineCronProcessPendingRequest from './answerMachineCronProcessPendingRequest';

/**
 * Picks one pending Answer Machine V4 request (newest `_id`) and runs background iterations.
 * Invoked by the dedicated AM4 cron schedule in srcCron/indexCron.ts.
 */
const answerMachineV4CronTick = async (): Promise<void> => {
    try {
        console.log('running Answer Machine V4 cron (pending request row)');
        const pending = await ModelAnswerMachineRequestV4.findOne({
            status: 'pending',
        }).sort({ _id: -1 });

        if (pending) {
            console.log('found pending Answer Machine V4 request: ', pending._id);
            await answerMachineCronProcessPendingRequest({
                answerMachineRequestV4Id: pending._id as mongoose.Types.ObjectId,
            });
        }
    } catch (error) {
        console.error('error in answerMachineV4CronTick: ', error);
    }
};

export default answerMachineV4CronTick;
