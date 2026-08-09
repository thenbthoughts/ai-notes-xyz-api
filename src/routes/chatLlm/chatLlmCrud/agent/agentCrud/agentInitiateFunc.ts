import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAgentInstance } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentUpdate } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelAgentMemory } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { Message } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../../chatUtils/chatLlmGetLlmConfig';
import enqueueAgentTickPendingTask from '../../../../../utils/llmPendingTask/page/agent/enqueueAgentTickPendingTask';
import cancelPendingAgentTickTasks from '../../../../../utils/llmPendingTask/page/agent/cancelPendingAgentTickTasks';
import writeAgentLog, { fetchLlmUnifiedLogged } from '../agentUtils/agentWriteLog';
import { ensureAgentTerminalChatMessage } from '../agentUtils/ensureAgentTerminalChatMessage';
import { normalizeAgentBudgetLimits } from '../agentStats/agentBudget';
import { IAgentGoal } from '../../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentGoal.types';

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

const agentInitiateFunc = async ({
    messageId,
}: {
    messageId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    errorReason: string;
    agentInstanceId: string | null;
}> => {
    try {
        const message = await ModelChatLlm.findById(messageId);
        if (!message) {
            return { success: false, errorReason: 'Message not found', agentInstanceId: null };
        }

        const thread = await ModelChatLlmThread.findById(message.threadId);
        if (!thread) {
            return { success: false, errorReason: 'Thread not found', agentInstanceId: null };
        }

        if (thread.answerEngine !== 'agent') {
            return { success: false, errorReason: 'Thread is not configured for Agent', agentInstanceId: null };
        }

        // Stop any previously running agent on this thread
        const previousAgents = await ModelAgentInstance.find({
            threadId: message.threadId,
            userId: thread.userId,
            status: 'pending',
        })
            .select('_id')
            .lean();

        if (previousAgents.length > 0) {
            const prevIds = previousAgents.map((a) => a._id as mongoose.Types.ObjectId);
            await ModelAgentInstance.updateMany(
                { _id: { $in: prevIds } },
                {
                    $set: {
                        status: 'failed',
                        statusIsRunning: false,
                        updatedAtUtc: new Date(),
                        cancellationRequestedUtc: new Date(),
                    },
                }
            );
            await cancelPendingAgentTickTasks({ agentInstanceId: prevIds });
            const prevThreadId = new mongoose.Types.ObjectId(String(message.threadId));
            for (const prevId of prevIds) {
                await writeAgentLog({
                    agentInstanceId: prevId,
                    userId: thread.userId as mongoose.Types.ObjectId,
                    threadId: prevThreadId,
                    action: 'agent_stopped',
                    message: 'Previous agent stopped because a new agent was started on this thread.',
                    level: 'warn',
                });
                try {
                    await ensureAgentTerminalChatMessage({
                        agentInstanceId: prevId,
                        userId: thread.userId as mongoose.Types.ObjectId,
                        threadId: prevThreadId,
                        outcome: 'failed',
                        reason: 'Previous agent stopped because a new agent was started on this thread.',
                    });
                } catch (e) {
                    console.error('ensureAgentTerminalChatMessage on supersede failed:', e);
                }
            }
        }

        const userText =
            message.type === 'text' && typeof message.content === 'string' ? message.content.trim() : '';

        // Seed as a single top-level goal; PLAN stage expands format/sub-goals.
        let goals: Array<{ title: string; description: string }> = [
            {
                title: (userText.slice(0, 200) || 'Complete user request').trim(),
                description: userText || 'Complete user request',
            },
        ];

        const threadObjectId = message.threadId
            ? new mongoose.Types.ObjectId(String(message.threadId))
            : null;
        if (!threadObjectId) {
            return { success: false, errorReason: 'Thread ID missing on message', agentInstanceId: null };
        }

        const budgets = normalizeAgentBudgetLimits({
            minBudgetTokens: thread.agentMinBudgetTokens,
            maxBudgetTokens: thread.agentMaxBudgetTokens,
            minNumberOfIterations: thread.agentMinNumberOfIterations,
            maxNumberOfIterations: thread.agentMaxNumberOfIterations,
        });

        // Create instance early so goal-refine LLM (and later ticks) can write agentLog rows.
        const agentInstance = await ModelAgentInstance.create({
            threadId: message.threadId,
            parentMessageId: messageId,
            userId: thread.userId,
            status: 'pending',
            brainStep: 'think',
            statusIsRunning: true,
            errorReason: '',
            tickCount: 0,
            lastTickAtUtc: null,
            tickLockUntilUtc: null,
            cancellationRequestedUtc: null,
            summary: '',
            minBudgetTokens: budgets.minBudgetTokens,
            maxBudgetTokens: budgets.maxBudgetTokens,
            minNumberOfIterations: budgets.minNumberOfIterations,
            maxNumberOfIterations: budgets.maxNumberOfIterations,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });

        const logCtx = {
            agentInstanceId: agentInstance._id as mongoose.Types.ObjectId,
            userId: thread.userId as mongoose.Types.ObjectId,
            threadId: threadObjectId,
            tickNumber: 0,
        };

        const llmConfig = await getLlmConfig({ threadId: threadObjectId });
        if (llmConfig && userText) {
            try {
                const messages: Message[] = [
                    {
                        role: 'system',
                        content:
                            'Extract concrete goals for an autonomous agent from the user message. Return JSON only: {"goals":[{"title":"...","description":"..."}]} . Create as many goals as the request truly needs — no fixed minimum or maximum. Prefer one goal when the request is a single deliverable; split into multiple goals only for clearly independent deliverables or distinct sequential outcomes the user asked for. Titles short. Description = full success criteria. Do not invent personal facts. Do not invent micro-steps (e.g. separate “fetch time” vs “create PDF”) unless the user asked for those as separate outcomes — fine-grained sequencing belongs in plan expansion subGoals.',
                    },
                    { role: 'user', content: userText },
                ];
                const llmResult = await fetchLlmUnifiedLogged({
                    logCtx,
                    purpose: 'agent_goal_refine',
                    params: {
                        provider: llmConfig.provider,
                        apiKey: llmConfig.apiKey,
                        apiEndpoint: llmConfig.apiEndpoint,
                        model: llmConfig.model,
                        messages,
                        temperature: 0.2,
                        maxTokens: 4000,
                        responseFormat: 'json_object',
                        headersExtra: llmConfig.customHeaders,
                    },
                });
                const parsed = extractJsonObject(llmResult.content || '');
                const arr = parsed?.goals;
                if (Array.isArray(arr) && arr.length > 0) {
                    const refined = arr
                        .map((g) => {
                            if (!g || typeof g !== 'object') return null;
                            const obj = g as Record<string, unknown>;
                            const title = String(obj.title || obj.description || '').trim();
                            const description = String(obj.description || obj.title || '').trim();
                            if (!title) return null;
                            return { title: title.slice(0, 200), description: description || title };
                        })
                        .filter((g): g is { title: string; description: string } => g !== null);
                    if (refined.length > 0) {
                        goals = refined;
                    }
                }
            } catch (e) {
                console.error('agentInitiateFunc goal LLM refine failed:', e);
            }
        }

        const now = new Date();
        const goalDocs = goals.map((g, i) => ({
            agentInstanceId: agentInstance._id,
            userId: thread.userId,
            threadId: message.threadId,
            parentGoalId: null,
            orderIndex: i,
            title: g.title,
            description: g.description,
            status: 'pending' as const,
            result: '',
            createdAtUtc: now,
            updatedAtUtc: now,
            completedAtUtc: null,
        }));
        const insertedGoals = (await ModelAgentGoal.insertMany(goalDocs)) as unknown as IAgentGoal[];

        await ModelAgentMemory.create({
            agentInstanceId: agentInstance._id,
            userId: thread.userId,
            threadId: message.threadId,
            key: 'user_request',
            content: userText,
            memoryType: 'fact',
            createdAtUtc: now,
            updatedAtUtc: now,
        });

        await ModelAgentUpdate.create({
            agentInstanceId: agentInstance._id,
            userId: thread.userId,
            threadId: message.threadId,
            updateType: 'status',
            message: `Agent started — brain loop (Think → Plan → Use Tool → Observe → Final Answer) with ${insertedGoals.length} top-level goal(s).`,
            payload: {
                brainStep: 'think',
                goalsCount: insertedGoals.length,
                goals: insertedGoals.map((g) => g.title),
            },
            goalId: null,
            tickNumber: 0,
            createdAtUtc: now,
        });

        await writeAgentLog({
            ...logCtx,
            action: 'agent_started',
            message: `Agent started — brain loop (Think → Plan → Use Tool → Observe → Final Answer) with ${insertedGoals.length} top-level goal(s).`,
            payload: {
                brainStep: 'think',
                goalsCount: insertedGoals.length,
                goals: insertedGoals.map((g) => g.title),
            },
            tickNumber: 0,
        });

        const goalLines = insertedGoals.map((g, i) => `${i + 1}. ${g.title}`).join('\n');

        await ModelChatLlm.create({
            type: 'text',
            content: `Agent started — brain loop.\n\nGoals:\n${goalLines}\n\nWorking in the background (Think → Plan → Use Tool → Observe → Final Answer) until the budget is reached or goals finish.`,
            userId: thread.userId.toString(),
            threadId: message.threadId,
            isAi: true,
            tags: ['agent'],
            aiModelProvider: llmConfig?.provider || '',
            aiModelName: llmConfig?.model || '',
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });

        await ModelAgentInstance.findByIdAndUpdate(agentInstance._id, {
            $set: { statusIsRunning: false, brainStep: 'think' },
        });

        await enqueueAgentTickPendingTask({
            userId: thread.userId,
            agentInstanceId: agentInstance._id as mongoose.Types.ObjectId,
        });

        return {
            success: true,
            errorReason: '',
            agentInstanceId: String(agentInstance._id),
        };
    } catch (error) {
        console.error(`agentInitiateFunc (${messageId}):`, error);
        return {
            success: false,
            errorReason: error instanceof Error ? error.message : 'Internal server error',
            agentInstanceId: null,
        };
    }
};

export default agentInitiateFunc;
