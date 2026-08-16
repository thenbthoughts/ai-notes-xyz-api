import { shellReadFile, getAgentShellConfig, agentTaskFilesDir } from '../agentShell/agentShellWorkspace';
import { getApiKeyByObject } from '../../../../../../utils/llm/llmCommonFunc';
import { ModelUserApiKey } from '../../../../../../schema/schemaUser/SchemaUserApiKey.schema';
import type { AgentLogContext } from '../agentWriteLog';
import mongoose from 'mongoose';

/**
 * Simple reader for progress.md. Cached per tick via memory if needed.
 */
export const readProgressFile = async (params: {
    threadId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    logCtx?: AgentLogContext | null;
}): Promise<string> => {
    const { threadId, userId, logCtx } = params;
    const apiKeyDoc = await ModelUserApiKey.findOne({ userId });
    if (!apiKeyDoc) return '';
    const shell = getAgentShellConfig(getApiKeyByObject(apiKeyDoc));
    if (!shell) return '';
    const relativePath = `${agentTaskFilesDir(String(threadId))}/progress.md`;
    try {
        const buf = await shellReadFile({ shell, relativePath, logCtx: logCtx || null });
        return buf.toString('utf8').slice(0, 4000);
    } catch {
        return '';
    }
};
