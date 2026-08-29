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
import {
    contextWindowLimitsFromDoc,
    formatContextChatTranscript,
    loadContextChatWindow,
    withContextChatMessages,
} from '../agentUtils/agentContextWindow';
import { copyPastAgentRecords } from '../agentUtils/copyPastAgentRecords';
import { IAgentGoal } from '../../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentGoal.types';
import { dropMicroStepGoalSeeds } from '../agentPlan/agentGoalSeedFilter';

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

        const threadObjectId = message.threadId
            ? new mongoose.Types.ObjectId(String(message.threadId))
            : null;
        if (!threadObjectId) {
            return { success: false, errorReason: 'Thread ID missing on message', agentInstanceId: null };
        }

        const userText =
            message.type === 'text' && typeof message.content === 'string' ? message.content.trim() : '';
        const contextWindow = contextWindowLimitsFromDoc(thread);

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
            contextActionLimit: contextWindow.actionLimit,
            contextSummaryCount: contextWindow.summaryCount,
            contextMessagesPerSummary: contextWindow.messagesPerSummary,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
            completedAtUtc: null,
        });

        const logCtx = {
            agentInstanceId: agentInstance._id as mongoose.Types.ObjectId,
            userId: thread.userId as mongoose.Types.ObjectId,
            threadId: threadObjectId,
            tickNumber: 0,
        };

        try {
            await copyPastAgentRecords({
                toInstanceId: agentInstance._id as mongoose.Types.ObjectId,
                userId: thread.userId as mongoose.Types.ObjectId,
                threadId: threadObjectId,
                recordLimit: contextWindow.actionLimit,
            });
        } catch (e) {
            console.error('copyPastAgentRecords failed:', e);
        }

        // Write compressed progress file for multi-message threads (key points, goal, done, structure)
        try {
            const msgCount = await ModelChatLlm.countDocuments({ threadId: threadObjectId });
            if (msgCount > 3) {
                const { writeProgressFile } = await import('../agentUtils/agentProgress/agentProgressFile');
                await writeProgressFile({
                    threadId: threadObjectId,
                    agentInstanceId: agentInstance._id as mongoose.Types.ObjectId,
                    userId: thread.userId as mongoose.Types.ObjectId,
                    logCtx,
                });
            }
        } catch (e) {
            console.error('writeProgressFile failed:', e);
        }

        const chatWindow = await loadContextChatWindow({
            threadId: threadObjectId,
            actionLimit: contextWindow.actionLimit,
            summaryCount: contextWindow.summaryCount,
            messagesPerSummary: contextWindow.messagesPerSummary,
            agentInstanceId: agentInstance._id as mongoose.Types.ObjectId,
            userId: thread.userId as mongoose.Types.ObjectId,
            logCtx,
        });
        const conversationTranscript = formatContextChatTranscript(chatWindow.messages, chatWindow);
        const userRequestText = conversationTranscript || userText;
        const latestUserTurn = [...chatWindow.messages]
            .reverse()
            .find((m) => m.role === 'user' && typeof m.content === 'string');
        const seedText =
            (latestUserTurn && typeof latestUserTurn.content === 'string'
                ? latestUserTurn.content
                : userText) || 'Complete user request';
        let goals: Array<{ title: string; description: string }> = [
            {
                title: (seedText.slice(0, 200) || 'Complete user request').trim(),
                description: userRequestText || seedText,
            },
        ];

        const llmConfig = await getLlmConfig({ threadId: threadObjectId });
        if (llmConfig && (userText || chatWindow.messages.length > 0)) {
            try {
                const messages: Message[] = withContextChatMessages(
                    {
                        role: 'system',
                        content:
                            'You are a planner. Extract concrete deliverable goals for an autonomous agent from the conversation. The messages above are the last N thread turns (N = Actions to pass). Older turns are compressed into MESSAGE SUMMARIES (max = Summaries to pass) and one GLOBAL MESSAGE SUMMARY. Treat the latest user turn as a follow-up when prior turns exist — do not redefine a word the user is clarifying. Return JSON only: {"goals":[{"title":"...","description":"..."}]} . For the vast majority of tasks, divide into 2-4 distinct deliverable goals when the request has multiple files, formats, or phases (e.g. research + creation, create + transform + verify). Each goal = one verifiable outcome (a file, a research synthesis, an edit) not a micro-step like "fetch time" vs "create PDF" or "create the file" vs "print path/size". For a single-deliverable request (e.g. one PDF, one Excel, one image transform), keep ONE top-level goal — plan expansion will split it into 3-5 subGoals (discover → implement → verify). Titles short (<=12 words). Description = full success criteria (what is created, where, how to verify). Do not invent personal facts. Goal count: 1-4, prefer 2-3 when multiple deliverables are implied; 1 is fine when plan expansion will handle the phases.',
                    },
                    chatWindow,
                    {
                        role: 'user',
                        content:
                            'Extract goals from the conversation above. If the latest user message is a clarification of an earlier request, keep the original task and apply the clarification. Divide so the vast majority of tasks can be completed reliably.',
                    }
                );
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
                    const filtered = dropMicroStepGoalSeeds(refined);
                    if (filtered.length > 0) {
                        goals = filtered;
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
            content: (userRequestText || userText).slice(0, 8000),
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
