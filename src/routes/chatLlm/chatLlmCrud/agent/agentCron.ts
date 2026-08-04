import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import agentProcessTick from './agentProcessTick';

/**
 * Background cron ticker for AI Agent execution loop.
 * Checks every 2 seconds in background (srcCron/indexCron.ts).
 * Runs ONE agent instance at a time sequentially (non-parallel).
 */
export const agentCronTick = async (): Promise<void> => {
    try {
        // Pick ONE active pending agent at a time sequentially
        const activeAgent = await ModelAgentInstance.findOne({
            status: 'pending',
            statusIsRunning: false,
            cancellationRequestedUtc: null,
        }).sort({ updatedAtUtc: 1 });

        if (activeAgent) {
            try {
                await agentProcessTick(activeAgent._id);
            } catch (err) {
                console.error(`agentCronTick error for instance ${activeAgent._id}:`, err);
            }
        }
    } catch (err) {
        console.error('agentCronTick top-level error:', err);
    }
};

export default agentCronTick;
