import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentMemory } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentUpdate } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import fetchLlmUnified, { Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../answerMachineShared/answerMachineGetLlmConfig';
import {
    searchAgentDomain,
    type AgentDomainSearchSource,
} from './agentDomainAccess';
import agentCreateExcelFile from './agentCreateExcelFile';
import agentCreateExcelViaShell from './agentCreateExcelViaShell';

const TICK_LOCK_MS = 300_000;

type AgentAction =
    | 'search_notes'
    | 'search_tasks'
    | 'search_life_events'
    | 'search_info_vault'
    | 'write_memory'
    | 'create_excel'
    | 'complete_goal'
    | 'fail_goal'
    | 'post_message'
    | 'noop';

interface AgentTickDecision {
    action: AgentAction;
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
    const action = String(parsed.action || 'noop') as AgentAction;
    const allowed: AgentAction[] = [
        'search_notes',
        'search_tasks',
        'search_life_events',
        'search_info_vault',
        'write_memory',
        'create_excel',
        'complete_goal',
        'fail_goal',
        'post_message',
        'noop',
    ];
    return {
        action: allowed.includes(action) ? action : 'noop',
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

const sourceForAction = (action: AgentAction): AgentDomainSearchSource | null => {
    if (action === 'search_notes') return 'notes';
    if (action === 'search_tasks') return 'tasks';
    if (action === 'search_life_events') return 'lifeEvents';
    if (action === 'search_info_vault') return 'infoVault';
    return null;
};

const writeUpdate = async ({
    agentInstanceId,
    userId,
    threadId,
    updateType,
    message,
    payload,
    goalId,
    tickNumber,
}: {
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    updateType: string;
    message: string;
    payload?: Record<string, unknown>;
    goalId?: mongoose.Types.ObjectId | null;
    tickNumber: number;
}) => {
    await ModelAgentUpdate.create({
        agentInstanceId,
        userId,
        threadId,
        updateType,
        message,
        payload: payload || {},
        goalId: goalId || null,
        tickNumber,
        createdAtUtc: new Date(),
    });
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
        return;
    }

    const tickNumber = (agent.tickCount || 0) + 1;

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
            return;
        }

        const memories = await ModelAgentMemory.find({
            agentInstanceId: agent._id,
        })
            .sort({ createdAtUtc: -1 })
            .limit(20)
            .lean();

        const recentUpdates = await ModelAgentUpdate.find({
            agentInstanceId: agent._id,
        })
            .sort({ createdAtUtc: -1 })
            .limit(10)
            .lean();

        const llmConfig = await getLlmConfig({ threadId: agent.threadId });
        if (!llmConfig) {
            throw new Error('No LLM config available for agent tick');
        }

        const systemPrompt = `You are a background agent. The user is NOT available to answer clarifying questions.
You have access to the user's personal data domains:
- notes
- tasks
- lifeEvents
- infoVault

You also have per-instance memory and can create downloadable Excel (.xlsx) files.

Current goal must be completed. Each response is ONE action as JSON only:
{
  "action": "search_notes"|"search_tasks"|"search_life_events"|"search_info_vault"|"write_memory"|"create_excel"|"complete_goal"|"fail_goal"|"post_message"|"noop",
  "query": "search text when searching",
  "memoryKey": "short key",
  "memoryContent": "what to store",
  "memoryType": "fact"|"observation"|"plan"|"result"|"other",
  "goalResult": "final result text when completing/failing goal",
  "message": "short user-visible message when post_message or create_excel",
  "fileName": "my-file.xlsx when create_excel",
  "sheetName": "Sheet1 when create_excel",
  "columns": ["ColA","ColB"] ,
  "rows": [{"ColA":"v1","ColB":"v2"}] ,
  "reason": "why this action"
}

Rules:
- Prefer searching domains before completing a goal when the goal needs personal context.
- Use write_memory to retain useful findings.
- If the user asks for Excel, spreadsheet, xlsx, or a downloadable file of tabular/list data, you MUST use create_excel with the full rows (not just complete_goal with text). Include enough rows to satisfy the request (e.g. major cities by region). Excel is generated on the Shell Engine under ai-notes-xyz/task/{id}/files.
- After a successful create_excel, call complete_goal on the next tick summarizing the filename and row count.
- For generative/list goals without an Excel request, produce content via complete_goal (or create_excel if a spreadsheet is clearly better).
- Never wait for user input. Make reasonable assumptions and finish.
- Use post_message only for brief progress notes, not to ask questions.
- Avoid noop unless you truly need another tick after a search/memory write. Do not noop while waiting for the user.
- Use complete_goal when the goal is done; include goalResult with the deliverable.
- Use fail_goal only if impossible.
- Keep actions small; the loop will continue on the next tick.`;

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
                    ? 'Excel file was already created and posted to chat with a download button. Call complete_goal now for the current goal (mention the filename). Do not create another Excel file.'
                    : wantsExcel
                      ? 'The user wants an Excel/downloadable file. Call create_excel NOW with fileName ending in .xlsx and rows as objects (e.g. Region + City). Do not only reply with text.'
                      : recentNoopCount >= 2
                        ? 'You have noop\'d too many times. You MUST complete_goal now with the best deliverable you can produce. Do not ask the user anything.'
                        : 'Produce progress toward completing the current goal. Do not ask the user for clarification.',
            },
            null,
            2
        );

        const messages: Message[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];

        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages,
            temperature: 0.3,
            maxTokens: 4000,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
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

        const domainSource = sourceForAction(decision.action);
        if (domainSource) {
            const hits = await searchAgentDomain({
                userId: agent.userId,
                source: domainSource,
                query: decision.query || currentGoal.title,
                limit: 8,
            });

            const hitText = hits.length
                ? hits.map((h) => `- [${h.source}] ${h.title}: ${h.summary}`).join('\n')
                : 'No results.';

            await ModelAgentMemory.create({
                agentInstanceId: agent._id,
                userId: agent.userId,
                threadId: agent.threadId,
                key: `search_${domainSource}_${tickNumber}`,
                content: `Query: ${decision.query || currentGoal.title}\n${hitText}`.slice(0, 8000),
                memoryType: 'observation',
                createdAtUtc: new Date(),
                updatedAtUtc: new Date(),
            });

            await writeUpdate({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'domain_search',
                message: `Searched ${domainSource}: ${hits.length} hit(s)`,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
                payload: { source: domainSource, hitsCount: hits.length, query: decision.query || '' },
            });
        } else if (decision.action === 'write_memory') {
            const content = (decision.memoryContent || decision.message || '').trim();
            if (content) {
                await ModelAgentMemory.create({
                    agentInstanceId: agent._id,
                    userId: agent.userId,
                    threadId: agent.threadId,
                    key: (decision.memoryKey || `mem_${tickNumber}`).slice(0, 120),
                    content: content.slice(0, 8000),
                    memoryType: decision.memoryType || 'observation',
                    createdAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                });
                await writeUpdate({
                    agentInstanceId: agent._id as mongoose.Types.ObjectId,
                    userId: agent.userId,
                    threadId: agent.threadId,
                    updateType: 'memory_written',
                    message: `Memory saved: ${decision.memoryKey || 'note'}`,
                    goalId: currentGoal._id as mongoose.Types.ObjectId,
                    tickNumber,
                });
            }
        } else if (decision.action === 'post_message') {
            const msg = (decision.message || decision.goalResult || '').trim();
            if (msg) {
                await ModelChatLlm.create({
                    type: 'text',
                    content: msg,
                    userId: agent.userId.toString(),
                    threadId: agent.threadId,
                    isAi: true,
                    tags: ['agent'],
                    aiModelProvider: llmConfig.provider,
                    aiModelName: llmConfig.model,
                    createdAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                });
                await writeUpdate({
                    agentInstanceId: agent._id as mongoose.Types.ObjectId,
                    userId: agent.userId,
                    threadId: agent.threadId,
                    updateType: 'message',
                    message: msg.slice(0, 500),
                    goalId: currentGoal._id as mongoose.Types.ObjectId,
                    tickNumber,
                });
            }
        } else if (decision.action === 'create_excel') {
            const viaShell = await agentCreateExcelViaShell({
                userId: agent.userId,
                threadId: agent.threadId,
                taskId: String(agent._id),
                fileName: decision.fileName || 'export.xlsx',
                sheetName: decision.sheetName || 'Sheet1',
                columns: decision.columns,
                rows: decision.rows,
                message: decision.message || decision.goalResult || '',
                aiModelProvider: llmConfig.provider,
                aiModelName: llmConfig.model,
            });

            let excelResult = viaShell;
            if (!viaShell.success) {
                const fallback = await agentCreateExcelFile({
                    userId: agent.userId,
                    threadId: agent.threadId,
                    fileName: decision.fileName || 'export.xlsx',
                    sheetName: decision.sheetName || 'Sheet1',
                    columns: decision.columns,
                    rows: decision.rows,
                    message:
                        `${decision.message || decision.goalResult || 'Excel file ready.'}\n\n` +
                        `_(Generated locally — Shell Engine unavailable: ${viaShell.errorReason})_`,
                    aiModelProvider: llmConfig.provider,
                    aiModelName: llmConfig.model,
                });
                if (!fallback.success) {
                    throw new Error(
                        `Shell Excel failed: ${viaShell.errorReason}; local fallback failed: ${fallback.errorReason}`,
                    );
                }
                excelResult = {
                    success: true,
                    errorReason: '',
                    fileName: fallback.fileName,
                    objectKey: fallback.objectKey,
                    rowCount: fallback.rowCount,
                    messageId: fallback.messageId,
                    workspaceDir: '',
                    shellAbsolutePath: '',
                };
            }

            await ModelAgentMemory.create({
                agentInstanceId: agent._id,
                userId: agent.userId,
                threadId: agent.threadId,
                key: `excel_${tickNumber}`,
                content: `Created Excel file ${excelResult.fileName} (${excelResult.rowCount} rows)${
                    viaShell.success ? ` via shell workspace ${viaShell.workspaceDir}` : ' via local fallback'
                }. objectKey=${excelResult.objectKey}`,
                memoryType: 'result',
                createdAtUtc: new Date(),
                updatedAtUtc: new Date(),
            });

            await writeUpdate({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'excel_created',
                message: `Excel created: ${excelResult.fileName} (${excelResult.rowCount} rows${
                    viaShell.success ? `, shell:${viaShell.workspaceDir}` : ', local'
                })`,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
                payload: {
                    fileName: excelResult.fileName,
                    rowCount: excelResult.rowCount,
                    objectKey: excelResult.objectKey,
                    messageId: excelResult.messageId,
                    method: viaShell.success ? 'shell_task_files' : 'local_fallback',
                    workspaceDir: viaShell.workspaceDir || '',
                    shellAbsolutePath: viaShell.shellAbsolutePath || '',
                    shellError: viaShell.success ? '' : viaShell.errorReason,
                },
            });
        } else if (decision.action === 'complete_goal' || decision.action === 'fail_goal') {
            const isFail = decision.action === 'fail_goal';
            currentGoal.status = isFail ? 'failed' : 'completed';
            currentGoal.result = (decision.goalResult || decision.message || decision.reason || '').slice(0, 8000);
            currentGoal.completedAtUtc = new Date();
            currentGoal.updatedAtUtc = new Date();
            await currentGoal.save();

            await ModelAgentMemory.create({
                agentInstanceId: agent._id,
                userId: agent.userId,
                threadId: agent.threadId,
                key: `goal_${currentGoal.orderIndex}_result`,
                content: currentGoal.result,
                memoryType: 'result',
                createdAtUtc: new Date(),
                updatedAtUtc: new Date(),
            });

            await writeUpdate({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: isFail ? 'goal_failed' : 'goal_completed',
                message: `${isFail ? 'Failed' : 'Completed'} goal: ${currentGoal.title}`,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
                payload: { result: currentGoal.result },
            });

            await ModelChatLlm.create({
                type: 'text',
                content: `${isFail ? 'Goal failed' : 'Goal completed'}: ${currentGoal.title}\n\n${currentGoal.result || '(no details)'}`,
                userId: agent.userId.toString(),
                threadId: agent.threadId,
                isAi: true,
                tags: ['agent'],
                aiModelProvider: llmConfig.provider,
                aiModelName: llmConfig.model,
                createdAtUtc: new Date(),
                updatedAtUtc: new Date(),
            });
        }

        await ModelAgentInstance.findByIdAndUpdate(agent._id, {
            $set: {
                tickCount: tickNumber,
                lastTickAtUtc: new Date(),
                tickLockUntilUtc: null,
                updatedAtUtc: new Date(),
            },
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
