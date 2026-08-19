import { ModelAgentOpencodeInstance } from '../../../../schema/schemaChatLlm/SchemaAgentOpencode/SchemaAgentOpencodeInstance.schema';
import agentOpencodeCreateWorkspaceFiles from './agentOpencodeCreateWorkspaceFiles';

/**
 * Background cron for Agent (Opencode).
 * Picks ONE pending instance and runs input -> Cursor -> output.
 */
export const agentOpencodeCronTick = async (): Promise<void> => {
    try {
        const locked = await ModelAgentOpencodeInstance.findOneAndUpdate(
            {
                status: 'pending',
                statusIsRunning: false,
            },
            {
                $set: {
                    statusIsRunning: true,
                    updatedAtUtc: new Date(),
                },
            },
            {
                sort: { createdAtUtc: 1 },
                new: true,
            }
        );

        if (!locked) {
            return;
        }

        try {
            await agentOpencodeCreateWorkspaceFiles(locked);
        } catch (err) {
            console.error(`agentOpencodeCronTick error for instance ${locked._id}:`, err);
            await ModelAgentOpencodeInstance.findByIdAndUpdate(locked._id, {
                $set: {
                    status: 'failed',
                    statusIsRunning: false,
                    errorReason: err instanceof Error ? err.message : 'Cron failed',
                    updatedAtUtc: new Date(),
                },
            });
        }
    } catch (err) {
        console.error('agentOpencodeCronTick top-level error:', err);
    }
};

export default agentOpencodeCronTick;
