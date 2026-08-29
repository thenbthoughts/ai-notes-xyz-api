import mongoose from 'mongoose';

import { ModelLlmPendingTaskCron } from '../../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../llmPendingTaskConstants';

/**
 * Mark pending Agent tick tasks as failed so cron will not pick them up.
 */
const cancelPendingAgentTickTasks = async ({
    agentInstanceId,
}: {
    agentInstanceId: mongoose.Types.ObjectId | string | Array<mongoose.Types.ObjectId | string>;
}): Promise<number> => {
    const ids = (Array.isArray(agentInstanceId) ? agentInstanceId : [agentInstanceId]).map((id) =>
        typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
    );

    if (ids.length === 0) {
        return 0;
    }

    const result = await ModelLlmPendingTaskCron.updateMany(
        {
            taskType: llmPendingTaskTypes.page.agent.agentTick,
            targetRecordId: { $in: ids },
            taskStatus: 'pending',
        },
        {
            $set: {
                taskStatus: 'failed',
                taskStatusFailed: 'Agent stopped or replaced',
                updatedAtUtc: new Date(),
            },
        }
    );

    return result.modifiedCount || 0;
};

export default cancelPendingAgentTickTasks;
