import { ModelChatLlm } from '../../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentGoal } from '../../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentMemory } from '../../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { listWorkspaceDeliverables } from '../../agentWork/agentPlanVerify';
import { shellWriteFile } from '../agentShell/agentShellWorkspace';
import type { AgentLogContext } from '../agentWriteLog';
import { getApiKeyByObject } from '../../../../../../utils/llm/llmCommonFunc';
import { ModelUserApiKey } from '../../../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getAgentShellConfig } from '../agentShell/agentShellWorkspace';
import { agentTaskFilesDir } from '../agentShell/agentShellWorkspace';
import mongoose from 'mongoose';

type ProgressInput = {
    threadId: mongoose.Types.ObjectId;
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    logCtx: AgentLogContext;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Build compressed progress content for multi-message threads.
 * Simple, maintainable: collects chat last 5, completed goals, deliverables.
 */
export const buildProgressContent = async (params: ProgressInput): Promise<string> => {
    const { threadId, agentInstanceId } = params;

    const [chats, goals, memories] = await Promise.all([
        ModelChatLlm.find({ threadId }).sort({ createdAtUtc: -1 }).limit(10).lean(),
        ModelAgentGoal.find({ agentInstanceId }).sort({ orderIndex: 1 }).lean(),
        ModelAgentMemory.find({ agentInstanceId }).sort({ updatedAtUtc: -1 }).limit(15).lean(),
    ]);

    const chatSummary = chats
        .slice()
        .reverse()
        .map((c) => `${c.isAi ? 'AI' : 'User'}: ${clip(String(c.content || ''), 200)}`)
        .join('\n');

    const done = goals.filter((g) => g.status === 'completed').map((g) => `- ${g.title}: ${clip(g.result || 'done', 120)}`);
    const pending = goals.filter((g) => g.status === 'pending' || g.status === 'in_progress').map((g) => `- ${g.title} [${g.status}]`);

    const memSummary = memories
        .filter((m) => !/^context_/i.test(m.key))
        .slice(0, 5)
        .map((m) => `${m.key}: ${clip(m.content, 120)}`)
        .join('\n');

    return [
        `# Progress — Thread ${String(threadId).slice(-6)}`,
        `## Key Points`,
        chatSummary || '(no chat yet)',
        `## Goal`,
        memSummary || '(see chat)',
        `## What Is Done`,
        done.length ? done.join('\n') : '(none yet)',
        `## Structure Progress`,
        pending.length ? pending.join('\n') : 'All sub-tasks completed',
        `## Next`,
        pending[0] || 'Finalize and report',
    ].join('\n\n');
};

/**
 * Write progress.md to agent workspace. Simple, single responsibility.
 */
export const writeProgressFile = async (params: ProgressInput): Promise<{ relativePath: string; absolutePath: string } | null> => {
    const { threadId, userId, logCtx } = params;
    const content = await buildProgressContent(params);
    const apiKeyDoc = await ModelUserApiKey.findOne({ userId });
    if (!apiKeyDoc) return null;
    const shell = getAgentShellConfig(getApiKeyByObject(apiKeyDoc));
    if (!shell) return null;
    const relativePath = `${agentTaskFilesDir(String(threadId))}/progress.md`;
    const res = await shellWriteFile({
        shell,
        relativePath,
        buffer: Buffer.from(content, 'utf8'),
        fileName: 'progress.md',
        mimeType: 'text/markdown',
        logCtx,
    });
    return { relativePath: res.relativePath, absolutePath: res.absolutePath };
};
