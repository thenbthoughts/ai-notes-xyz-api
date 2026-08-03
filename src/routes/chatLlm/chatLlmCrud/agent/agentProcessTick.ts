import mongoose from 'mongoose';
import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentMemory } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentUpdate } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../answerMachineShared/answerMachineGetLlmConfig';
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
    try {
        return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
        /* continue */
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
        } catch {
            return null;
        }
    }
    return null;
};

const parseDecision = (raw: string): AgentTickDecision => {
    const parsed = extractJsonObject(raw);
    if (!parsed) {
        return {
            action: 'complete_goal',
            goalResult: raw.slice(0, 2000) || 'Completed with unstructured response.',
            reason: 'fallback_parse',
        };
    }
    const action = String(parsed.action || 'noop');
    return {
        action,
        query: typeof parsed.query === 'string' ? parsed.query : '',
        memoryKey: typeof parsed.memoryKey === 'string' ? parsed.memoryKey : 'note',
        memoryContent: typeof parsed.memoryContent === 'string' ? parsed.memoryContent : '',
        memoryType: (['fact', 'observation', 'plan', 'result', 'other'] as const).includes(
            parsed.memoryType as 'fact'
        )
            ? (parsed.memoryType as 'fact' | 'observation' | 'plan' | 'result' | 'other')
            : 'observation',
        goalResult: typeof parsed.goalResult === 'string' ? parsed.goalResult : '',
        message: typeof parsed.message === 'string' ? parsed.message : '',
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        fileName: typeof parsed.fileName === 'string' ? parsed.fileName : '',
        sheetName: typeof parsed.sheetName === 'string' ? parsed.sheetName : '',
        columns: parsed.columns,
        rows: parsed.rows ?? parsed.excelRows,
    };
};

const agentProcessTick = async ({
    agentInstanceId,
}: {
    agentInstanceId: mongoose.Types.ObjectId;
}): Promise<void> => {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + TICK_LOCK_MS);

    const agent = await ModelAgentInstance.findOneAndUpdate(
        {
            _id: agentInstanceId,
            status: 'running',
            $or: [
                { tickLockUntilUtc: null },
                { tickLockUntilUtc: { $lte: now } },
            ],
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
            message: 'Agent stopped by cancellation request.',
            tickNumber: agent.tickCount,
        });
        await writeAgentLog({
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            action: 'agent_stopped',
            message: 'Agent stopped by cancellation request.',
            level: 'warn',
            tickNumber: agent.tickCount,
        });
        return;
    }

    const tickNumber = (agent.tickCount || 0) + 1;

    await writeAgentLog({
        agentInstanceId: agent._id as mongoose.Types.ObjectId,
        userId: agent.userId,
        threadId: agent.threadId,
        action: 'tick_start',
        message: `Tick ${tickNumber} started`,
        level: 'debug',
        tickNumber,
    });

    try {
        let currentGoal = await ModelAgentGoal.findOne({
            agentInstanceId: agent._id,
            status: 'in_progress',
        }).sort({ orderIndex: 1 });

        if (!currentGoal) {
            currentGoal = await ModelAgentGoal.findOne({
                agentInstanceId: agent._id,
                status: 'pending',
            }).sort({ orderIndex: 1 });

            if (currentGoal) {
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
                    payload: { title: currentGoal.title },
                });
            }
        }

        if (!currentGoal) {
            // All goals done
            const completedGoals = await ModelAgentGoal.find({
                agentInstanceId: agent._id,
            }).sort({ orderIndex: 1 });

            const summary = completedGoals
                .map((g, i) => `${i + 1}. [${g.status}] ${g.title}${g.result ? `\n   ${g.result}` : ''}`)
                .join('\n');

            const llmConfig = await getLlmConfig({ threadId: agent.threadId });
            await ModelChatLlm.create({
                type: 'text',
                content: `Agent finished all goals.\n\n${summary}`,
                userId: agent.userId.toString(),
                threadId: agent.threadId,
                isAi: true,
                tags: ['agent'],
                aiModelProvider: llmConfig?.provider || '',
                aiModelName: llmConfig?.model || '',
                createdAtUtc: new Date(),
                updatedAtUtc: new Date(),
            });

            await ModelAgentInstance.findByIdAndUpdate(agent._id, {
                $set: {
                    status: 'completed',
                    summary: summary.slice(0, 4000),
                    tickCount: tickNumber,
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
                tickNumber,
            });
            await writeAgentLog({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                action: 'agent_completed',
                message: 'All goals completed. Agent finished.',
                tickNumber,
                payload: { summary: summary.slice(0, 1000) },
            });
            return;
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

        const userRequestMem = memories.find((m) => m.key === 'user_request');
        const userRequestText = userRequestMem?.content || '';
        const wantsExcel = /\b(excel|xlsx|spreadsheet|downloadable|download)\b/i.test(
            `${userRequestText}\n${currentGoal.title}\n${currentGoal.description}`
        );
        const alreadyCreatedExcel = recentUpdates.some((u) => u.updateType === 'excel_created')
            || memories.some((m) => typeof m.key === 'string' && m.key.startsWith('excel_'));

        const userPrompt = JSON.stringify(
            {
                currentGoal: {
                    title: currentGoal.title,
                    description: currentGoal.description,
                    status: currentGoal.status,
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
                wantsExcel,
                alreadyCreatedExcel,
                instruction: alreadyCreatedExcel
                    ? 'Excel file was already created. Call complete_goal now for current goal (mention filename).'
                    : wantsExcel
                      ? 'User requested Excel. Call create_excel NOW with fileName ending in .xlsx and structured rows.'
                      : recentNoopCount >= 2
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
            // Fallback for unrecognized action
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
                    decision as unknown as Record<string, unknown>
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

        await writeAgentLog({
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            action: 'tick_end',
            message: `Tick ${tickNumber} finished (${decision.action})`,
            level: 'debug',
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
            payload: { action: decision.action },
        });
    } catch (error) {
        console.error('agentProcessTick error:', error);
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        await writeUpdate({
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'error',
            message: errMsg,
            tickNumber,
        });
        await ModelAgentInstance.findByIdAndUpdate(agent._id, {
            $set: {
                status: 'error',
                errorReason: errMsg,
                tickCount: tickNumber,
                lastTickAtUtc: new Date(),
                tickLockUntilUtc: null,
                updatedAtUtc: new Date(),
            },
        });
    }
};

export default agentProcessTick;
