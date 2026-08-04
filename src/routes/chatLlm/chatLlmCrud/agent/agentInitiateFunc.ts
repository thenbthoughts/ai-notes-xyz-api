import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentUpdate } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelAgentMemory } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../answerMachineShared/answerMachineGetLlmConfig';
import enqueueAgentTickPendingTask from '../../../../utils/llmPendingTask/page/agent/enqueueAgentTickPendingTask';
import cancelPendingAgentTickTasks from '../../../../utils/llmPendingTask/page/agent/cancelPendingAgentTickTasks';
import writeAgentLog, { fetchLlmUnifiedLogged } from './agentWriteLog';

const parseGoalsFromText = (text: string): Array<{ title: string; description: string }> => {
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

    const bulletGoals = lines
        .map((line) => line.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
        .filter((line) => line.length > 0);

    if (bulletGoals.length >= 2) {
        return bulletGoals.map((g) => ({ title: g.slice(0, 200), description: g }));
    }

    // Semicolon / "and then" style
    const parts = text
        .split(/\s*(?:;|\band then\b|\bthen\b|\n)\s*/i)
        .map((p) => p.trim())
        .filter((p) => p.length > 8);

    if (parts.length >= 2) {
        return parts.map((g) => ({ title: g.slice(0, 200), description: g }));
    }

    return [{ title: text.slice(0, 200) || 'Complete user request', description: text || 'Complete user request' }];
};

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
            }
        }

        const userText =
            message.type === 'text' && typeof message.content === 'string' ? message.content.trim() : '';

        let goals = parseGoalsFromText(userText);

        const threadObjectId = message.threadId
            ? new mongoose.Types.ObjectId(String(message.threadId))
            : null;
        if (!threadObjectId) {
            return { success: false, errorReason: 'Thread ID missing on message', agentInstanceId: null };
        }

        // Create instance early so goal-refine LLM (and later ticks) can write agentLog rows.
        const agentInstance = await ModelAgentInstance.create({
            threadId: message.threadId,
            parentMessageId: messageId,
            userId: thread.userId,
            status: 'pending',
            statusIsRunning: true,
            errorReason: '',
            tickCount: 0,
            lastTickAtUtc: null,
            tickLockUntilUtc: null,
            cancellationRequestedUtc: null,
            summary: '',
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
                            'Extract a list of concrete goals from the user message for an autonomous agent. Return JSON only: {"goals":[{"title":"...","description":"..."}]} . Keep 1-8 goals. Titles short. If the user wants an Excel/spreadsheet/downloadable file, use ONE goal that includes generating and delivering that file (do not split into separate create-list / create-excel / provide-download goals).',
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
                        maxTokens: 1200,
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
                        goals = refined.slice(0, 8);
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
            orderIndex: i,
            title: g.title,
            description: g.description,
            status: 'pending' as const,
            result: '',
            createdAtUtc: now,
            updatedAtUtc: now,
            completedAtUtc: null,
        }));
        await ModelAgentGoal.insertMany(goalDocs);

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
            message: `Agent started with ${goals.length} goal(s). Running in background.`,
            payload: { goalsCount: goals.length, goals: goals.map((g) => g.title) },
            goalId: null,
            tickNumber: 0,
            createdAtUtc: now,
        });

        await writeAgentLog({
            ...logCtx,
            action: 'agent_started',
            message: `Agent started with ${goals.length} goal(s). Running in background.`,
            payload: { goalsCount: goals.length, goals: goals.map((g) => g.title) },
            tickNumber: 0,
        });

        await ModelChatLlm.create({
            type: 'text',
            content: `Agent started.\n\nGoals:\n${goals.map((g, i) => `${i + 1}. ${g.title}`).join('\n')}\n\nWorking in the background — updates will appear as goals complete.`,
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
            $set: { statusIsRunning: false }
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
