import mongoose from 'mongoose';

import { ModelLlmPendingTaskCron } from '../../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../llmPendingTaskConstants';

/**
 * Enqueue one Agent background tick via llmPendingTask cron.
 * Skips if a pending tick already exists for this agent instance,
 * unless `force` is set (used when re-enqueueing after the current tick
 * while that same pending row is still marked pending).
 */
const enqueueAgentTickPendingTask = async ({
    userId,
    agentInstanceId,
    force = false,
}: {
    userId: mongoose.Types.ObjectId | string;
    agentInstanceId: mongoose.Types.ObjectId | string;
    force?: boolean;
}): Promise<{ enqueued: boolean }> => {
    const uid =
        typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const aid =
        typeof agentInstanceId === 'string'
            ? new mongoose.Types.ObjectId(agentInstanceId)
            : agentInstanceId;

    if (!force) {
        const existing = await ModelLlmPendingTaskCron.findOne({
            taskType: llmPendingTaskTypes.page.agent.agentTick,
            targetRecordId: aid,
            taskStatus: 'pending',
        })
            .select('_id')
            .lean();

        if (existing) {
            return { enqueued: false };
        }
    }

    await ModelLlmPendingTaskCron.create({
        userId: uid,
        taskType: llmPendingTaskTypes.page.agent.agentTick,
        targetRecordId: aid,
        taskStatus: 'pending',
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });

    return { enqueued: true };
};

export default enqueueAgentTickPendingTask;
