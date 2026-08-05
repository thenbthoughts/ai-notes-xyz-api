import mongoose from 'mongoose';

import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import agentProcessTick from '../../../../routes/chatLlm/chatLlmCrud/agent/agentProcessTick';
import enqueueAgentTickPendingTask from './enqueueAgentTickPendingTask';

/**
 * llmPendingTask handler: run one Agent tick, then re-enqueue while still running.
 */
const agentTickByPendingTask = async ({
    targetRecordId,
}: {
    targetRecordId: mongoose.Types.ObjectId | string | null;
}): Promise<boolean> => {
    try {
        if (!targetRecordId) {
            return true;
        }

        const agentInstanceId =
            typeof targetRecordId === 'string'
                ? new mongoose.Types.ObjectId(targetRecordId)
                : targetRecordId;

        const agentBefore = await ModelAgentInstance.findById(agentInstanceId)
            .select('_id userId status')
            .lean();

        if (!agentBefore) {
            console.log('agentTickByPendingTask: agent instance not found', String(agentInstanceId));
            return true;
        }

        if (agentBefore.status !== 'pending') {
            console.log(
                'agentTickByPendingTask: agent not pending, skip',
                String(agentInstanceId),
                agentBefore.status
            );
            return true;
        }

        await agentProcessTick(agentInstanceId);

        const agentAfter = await ModelAgentInstance.findById(agentInstanceId)
            .select('_id userId status')
            .lean();

        if (agentAfter?.status === 'pending') {
            // force: current cron row is still "pending" until processFunc marks success,
            // so the normal dedupe would skip and the agent loop would stall after tick 1.
            await enqueueAgentTickPendingTask({
                userId: agentAfter.userId,
                agentInstanceId: agentAfter._id as mongoose.Types.ObjectId,
                force: true,
            });
        }

        return true;
    } catch (error) {
        console.error('agentTickByPendingTask error:', error);
        return false;
    }
};

export default agentTickByPendingTask;
