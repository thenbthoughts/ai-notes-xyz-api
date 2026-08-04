import mongoose from 'mongoose';
import axios from 'axios';
import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentMemory } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentUpdate } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelAgentLog } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentLog.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import { Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../answerMachineShared/answerMachineGetLlmConfig';
import { agentTaskFilesDir, getAgentShellConfig } from './agentShellWorkspace';
import writeAgentLog, { fetchLlmUnifiedLogged } from './agentWriteLog';
import { defaultAgentToolRegistry, writeUpdate } from './agentToolRegistry';

const TICK_LOCK_MS = 300_000;

interface AgentTickDecision {
    action: string;
    query?: string;
    memoryKey?: string;
    memoryContent?: string;
    memoryType?: 'fact' | 'observation' | 'plan' | 'result' | 'other';
    goalResult?: string;
    message?: string;
    reason?: string;
    fileName?: string;
    sheetName?: string;
    columns?: unknown;
    rows?: unknown;
}

const extractJsonObject = (raw: string): Record<string, unknown> | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        /* try regex */
    }
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            const parsed = JSON.parse(match[0]);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return null;
        }
    }
    return null;
};

const parseDecision = (raw: string): AgentTickDecision => {
    const json = extractJsonObject(raw);
    if (!json) {
        return { action: 'noop', reason: 'Unparseable LLM decision output' };
    }

    const action = typeof json.action === 'string' ? json.action.trim() : 'noop';
    return {
        action,
        query: typeof json.query === 'string' ? json.query : undefined,
        memoryKey: typeof json.memoryKey === 'string' ? json.memoryKey : undefined,
        memoryContent: typeof json.memoryContent === 'string' ? json.memoryContent : undefined,
        memoryType: (['fact', 'observation', 'plan', 'result', 'other'] as const).includes(json.memoryType as any)
            ? (json.memoryType as any)
            : undefined,
        goalResult: typeof json.goalResult === 'string' ? json.goalResult : undefined,
        message: typeof json.message === 'string' ? json.message : undefined,
        reason: typeof json.reason === 'string' ? json.reason : undefined,
        fileName: typeof json.fileName === 'string' ? json.fileName : undefined,
        sheetName: typeof json.sheetName === 'string' ? json.sheetName : undefined,
        columns: json.columns,
        rows: json.rows,
    };
};

/**
 * Executes a single tick step for a running Agent instance.
 */
export const agentProcessTick = async (agentInstanceId: mongoose.Types.ObjectId | string): Promise<void> => {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + TICK_LOCK_MS);

    const agent = await ModelAgentInstance.findOneAndUpdate(
        {
            _id: agentInstanceId,
            status: 'running',
            cancellationRequestedUtc: null,
            $or: [{ tickLockUntilUtc: null }, { tickLockUntilUtc: { $lt: now } }],
        },
        {
            $set: {
                tickLockUntilUtc: lockUntil,
                updatedAtUtc: now,
            },
        },
        { new: true }
    );

    if (!agent) {
        return;
    }

    try {
        if (agent.cancellationRequestedUtc) {
            await ModelAgentInstance.findByIdAndUpdate(agent._id, {
                $set: {
                    status: 'stopped',
                    tickLockUntilUtc: null,
                    updatedAtUtc: new Date(),
                },
            });
            await writeUpdate({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'status',
                message: 'Agent stopped upon user request.',
                tickNumber: agent.tickCount || 0,
            });
            await writeAgentLog({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                action: 'agent_stopped',
                message: 'Agent stopped upon user request.',
                tickNumber: agent.tickCount || 0,
            });
            return;
        }

        const goals = await ModelAgentGoal.find({
            agentInstanceId: agent._id,
        }).sort({ orderIndex: 1 });

        const currentGoal = goals.find((g) => g.status === 'in_progress' || g.status === 'pending');

        if (!currentGoal) {
            const completedCount = goals.filter((g) => g.status === 'completed').length;
            const summary = `Completed ${completedCount} of ${goals.length} goals.`;
            await ModelAgentInstance.findByIdAndUpdate(agent._id, {
                $set: {
                    status: 'completed',
                    summary: summary.slice(0, 4000),
                    tickCount: agent.tickCount || 0,
                    lastTickAtUtc: new Date(),
                    tickLockUntilUtc: null,
                    updatedAtUtc: new Date(),
                },
            });
            await writeUpdate({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'status',
                message: 'All goals completed. Agent finished.',
                tickNumber: agent.tickCount || 0,
            });
            await writeAgentLog({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                action: 'agent_completed',
                message: 'All goals completed. Agent finished.',
                tickNumber: agent.tickCount || 0,
                payload: { summary },
            });
            return;
        }

        const tickNumber = (agent.tickCount || 0) + 1;

        if (currentGoal.status === 'pending') {
            currentGoal.status = 'in_progress';
            currentGoal.updatedAtUtc = new Date();
            await currentGoal.save();

            await writeUpdate({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'goal_started',
                message: `Started goal: ${currentGoal.title}`,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
            });
            await writeAgentLog({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                action: 'goal_started',
                title: `Started goal: ${currentGoal.title}`,
                message: `Started goal: ${currentGoal.title}`,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
            });
        }

        await writeUpdate({
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'tick',
            message: `Tick ${tickNumber} started`,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
        });

        // 1. Past 10 Messages
        const recentChatDocs = await ModelChatLlm.find({ threadId: agent.threadId })
            .sort({ createdAtUtc: -1 })
            .limit(10);
        const past10Messages = recentChatDocs.reverse().map((m) => ({
            role: m.isAi ? 'assistant' : 'user',
            content: m.content.slice(0, 1000),
            createdAt: m.createdAtUtc,
        }));

        // 2. Past Goal Results
        const pastGoalResults = goals.map((g) => ({
            orderIndex: g.orderIndex,
            title: g.title,
            status: g.status,
            result: g.result || '(none)',
        }));

        // 3. Last 50 Logs
        const recentLogDocs = await ModelAgentLog.find({ agentInstanceId: agent._id })
            .sort({ createdAtUtc: -1 })
            .limit(50);
        const last50Logs = recentLogDocs.reverse().map((l) => ({
            tick: l.tickNumber,
            action: l.action,
            title: l.title,
            message: l.message.slice(0, 400),
            level: l.level,
        }));

        // 4. Dynamic Folder & File Structure of ai-notes-xyz-shell-files/agent/chat_id
        const agentShellDir = agentTaskFilesDir(String(agent.threadId));
        let shellWorkspaceListing: { relativePath: string; isDir: boolean; size: number }[] = [];
        try {
            const apiKeyDoc = await ModelUserApiKey.findOne({ userId: agent.userId });
            if (apiKeyDoc) {
                const apiKey = getApiKeyByObject(apiKeyDoc);
                const shell = getAgentShellConfig(apiKey);
                if (shell) {
                    const shellRes = await axios.get(
                        `${shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/list`,
                        {
                            params: { relativeDir: agentShellDir, maxFiles: 1000 },
                            timeout: 10_000,
                            headers: { 'X-API-Token': shell.token },
                            validateStatus: () => true,
                        }
                    );
                    if (shellRes.status === 200 && shellRes.data && typeof shellRes.data === 'object') {
                        const rawList = (shellRes.data as { files?: unknown }).files;
                        if (Array.isArray(rawList)) {
                            shellWorkspaceListing = rawList
                                .map((item) => {
                                    if (!item || typeof item !== 'object') return null;
                                    const o = item as Record<string, unknown>;
                                    const rel = typeof o.relativePath === 'string' ? o.relativePath.replace(/\\/g, '/') : '';
                                    if (!rel) return null;
                                    return {
                                        relativePath: rel,
                                        isDir: Boolean(o.isDir),
                                        size: typeof o.size === 'number' ? o.size : 0,
                                    };
                                })
                                .filter((i): i is NonNullable<typeof i> => i !== null);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to fetch dynamic shell file structure for tick:', e);
        }

        const memories = await ModelAgentMemory.find({
            agentInstanceId: agent._id,
        })
            .sort({ createdAtUtc: -1 })
            .limit(20);

        const recentUpdates = await ModelAgentUpdate.find({
            agentInstanceId: agent._id,
        })
            .sort({ createdAtUtc: -1 })
            .limit(10);

        const llmConfig = await getLlmConfig({ threadId: agent.threadId });
        if (!llmConfig) {
            throw new Error('No LLM config available for agent tick');
        }

        const systemPrompt = `You are an autonomous AI Agent powered by a modular Tool Registry.
The user is NOT available to answer clarifying questions.

Available Tools:
${defaultAgentToolRegistry.getToolDescriptions()}

Current goal must be completed. Return JSON ONLY with your chosen action and arguments:
{
  "action": "<tool_name>",
  "query": "search query or calculation expression",
  "memoryKey": "short memory key",
  "memoryContent": "content to store",
  "memoryType": "fact"|"observation"|"plan"|"result"|"other",
  "goalResult": "final result text when completing/failing goal",
  "message": "short message to post when posting message or creating excel",
  "fileName": "export.xlsx when create_excel",
  "sheetName": "Sheet1 when create_excel",
  "columns": ["ColA", "ColB"],
  "rows": [{"ColA": "val1", "ColB": "val2"}],
  "code": "const fs = require('fs'); ... (REQUIRED valid executable code when action is execute_script)",
  "reason": "explanation of tool choice"
}

Rules:
- Runtime Preference Hierarchy: (1) Node.js first (node), (2) Python 3 second (python3 / python), (3) system CLI utilities.
- When calling execute_script, you MUST provide valid, complete, runnable code in the "code" field.
- If a command fails or python is not found, the agent system automatically falls back to python3 and invokes LLM self-healing to generate an alternate solution.
- Search domain data before completing goals requiring personal context.
- Use write_memory to store facts and findings.
- Complete goal via complete_goal when done.
- Keep actions focused and progress toward completing the goal.`;

        const recentNoopCount = recentUpdates.filter((u) =>
            typeof u.message === 'string' && /\bnoop\b/i.test(u.message)
        ).length;

        const userPrompt = JSON.stringify(
            {
                currentGoal: {
                    title: currentGoal.title,
                    description: currentGoal.description,
                    status: currentGoal.status,
                },
                past10ChatMessages: past10Messages,
                pastGoalResults,
                last50AgentLogs: last50Logs,
                shellWorkspace: {
                    directoryPath: agentShellDir,
                    fileCount: shellWorkspaceListing.length,
                    filesAndFolders: shellWorkspaceListing,
                },
                memory: memories.map((m) => ({
                    key: m.key,
                    type: m.memoryType,
                    content: m.content.slice(0, 400),
                })),
                recentUpdates: recentUpdates.map((u) => ({
                    type: u.updateType,
                    message: u.message,
                })),
                tickNumber,
                recentNoopCount,
                instruction: recentNoopCount >= 2
                    ? 'Too many noops. Call complete_goal now with best deliverable.'
                    : 'Progress toward completing current goal using registered tools.',
            },
            null,
            2
        );

        const messages: Message[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];

        const logCtx = {
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
        };

        const llmResult = await fetchLlmUnifiedLogged({
            logCtx,
            purpose: 'agent_tick_decision',
            params: {
                provider: llmConfig.provider,
                apiKey: llmConfig.apiKey,
                apiEndpoint: llmConfig.apiEndpoint,
                model: llmConfig.model,
                messages,
                temperature: 0.3,
                maxTokens: 4000,
                responseFormat: 'json_object',
                headersExtra: llmConfig.customHeaders,
            },
        });

        const decision = parseDecision(llmResult.content || '');

        await writeUpdate({
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'tick',
            message: `Tick ${tickNumber}: ${decision.action}${decision.reason ? ` — ${decision.reason}` : ''}`,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
            payload: { action: decision.action, reason: decision.reason || '' },
        });

        const tool = defaultAgentToolRegistry.getTool(decision.action);
        if (tool) {
            await tool.execute(
                {
                    agentInstanceId: agent._id as mongoose.Types.ObjectId,
                    userId: agent.userId,
                    threadId: agent.threadId,
                    currentGoal,
                    memories,
                    recentUpdates,
                    tickNumber,
                    llmConfig,
                    logCtx,
                },
                decision as unknown as Record<string, unknown>
            );
        } else {
            const fallbackTool = defaultAgentToolRegistry.getTool('noop');
            if (fallbackTool) {
                await fallbackTool.execute(
                    {
                        agentInstanceId: agent._id as mongoose.Types.ObjectId,
                        userId: agent.userId,
                        threadId: agent.threadId,
                        currentGoal,
                        memories,
                        recentUpdates,
                        tickNumber,
                        llmConfig,
                        logCtx,
                    },
                    { reason: `Unrecognized action: ${decision.action}` }
                );
            }
        }

        await ModelAgentInstance.findByIdAndUpdate(agent._id, {
            $set: {
                tickCount: tickNumber,
                lastTickAtUtc: new Date(),
                tickLockUntilUtc: null,
                updatedAtUtc: new Date(),
            },
        });
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await ModelAgentInstance.findByIdAndUpdate(agent._id, {
            $set: {
                status: 'error',
                errorReason: errMsg.slice(0, 1000),
                tickLockUntilUtc: null,
                updatedAtUtc: new Date(),
            },
        });
        await writeUpdate({
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'error',
            message: `Agent tick error: ${errMsg}`,
            tickNumber: agent.tickCount || 0,
        });
        await writeAgentLog({
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            action: 'agent_error',
            message: errMsg,
            level: 'error',
            tickNumber: agent.tickCount || 0,
        });
    }
};

export default agentProcessTick;
