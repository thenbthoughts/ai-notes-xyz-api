import mongoose from 'mongoose';
import { Router, Request, Response } from 'express';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAgentInstance } from '../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentUpdate } from '../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelAgentMemory } from '../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentLog } from '../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentLog.schema';
import cancelPendingAgentTickTasks from '../../../utils/llmPendingTask/page/agent/cancelPendingAgentTickTasks';
import writeAgentLog from '../chatLlmCrud/agent/agentUtils/agentWriteLog';
import { detectSourcesSeenInMemory } from '../chatLlmCrud/agent/agentWork/agentPlanVerify';
import { ensureAgentTerminalChatMessage } from '../chatLlmCrud/agent/agentUtils/ensureAgentTerminalChatMessage';
import {
    budgetLimitsFromAgentDoc,
    computeAgentBudgetStatus,
    formatAgentBudgetContext,
} from '../chatLlmCrud/agent/agentStats/agentBudget';

const router = Router();

export interface AgentPollingResponse {
    isProcessing: boolean;
    status: 'pending' | 'success' | 'failed' | 'not_started';
    brainStep: 'think' | 'plan' | 'use_tool' | 'observe' | 'final_answer' | 'done' | null;
    agentInstanceId: string | null;
    tickCount: number;
    goals: Array<{
        id: string;
        title: string;
        description: string;
        status: string;
        result: string;
        orderIndex: number;
        parentGoalId: string | null;
    }>;
    updates: Array<{
        id: string;
        updateType: string;
        message: string;
        tickNumber: number;
        createdAtUtc: string;
        payload: Record<string, unknown>;
    }>;
    logs: Array<{
        id: string;
        level: string;
        action: string;
        title: string;
        message: string;
        tickNumber: number;
        createdAtUtc: string;
        payload: Record<string, unknown>;
        raw: unknown;
    }>;
    memoryCount: number;
    memories: Array<{
        id: string;
        key: string;
        memoryType: string;
        content: string;
        createdAtUtc: string;
    }>;
    tokenUsage: {
        prompt: number;
        completion: number;
        reasoning: number;
        total: number;
        costInUsd: number;
        maxPromptPerQuery: number;
        maxCompletionPerQuery: number;
    };
    budget?: {
        tokens: {
            used: number;
            min: number;
            max: number;
            remaining: number;
            pctUsed: number;
            pctRemaining: number;
        };
        iterations: {
            used: number;
            min: number;
            max: number;
            remaining: number;
            pctUsed: number;
            pctRemaining: number;
        };
        minsMet: boolean;
        maxExceeded: boolean;
        nearMax: boolean;
    };
    memoryStats: {
        total: number;
        byType: Record<string, number>;
    };
    activeSkillNames: string[];
    researchState: {
        phase: 'idle' | 'think' | 'plan' | 'use_tool' | 'observe' | 'final_answer' | 'done' | 'error';
        sourcesSeen: string[];
        evidenceGaps: string[];
        suggestedNextAction: string | null;
        suggestedQuery: string | null;
        researchBriefPreview: string | null;
        lastVerifyVerdict: string | null;
        confidence: 'low' | 'medium' | 'high';
    };
}

const emptyAgentTokenUsage = () => ({
    prompt: 0,
    completion: 0,
    reasoning: 0,
    total: 0,
    costInUsd: 0,
    maxPromptPerQuery: 0,
    maxCompletionPerQuery: 0,
});

const emptyAgentMemoryStats = () => ({
    total: 0,
    byType: {} as Record<string, number>,
});

const emptyResearchState = (): AgentPollingResponse['researchState'] => ({
    phase: 'idle',
    sourcesSeen: [],
    evidenceGaps: [],
    suggestedNextAction: null,
    suggestedQuery: null,
    researchBriefPreview: null,
    lastVerifyVerdict: null,
    confidence: 'low',
});

const buildResearchState = (params: {
    agentStatus: string;
    brainStep?: string | null;
    updates: Array<{ updateType: string; payload?: Record<string, unknown> | null }>;
    memories: Array<{ key: string; content: string }>;
}): AgentPollingResponse['researchState'] => {
    const { agentStatus, brainStep, updates, memories } = params;
    const sourcesSeen = detectSourcesSeenInMemory(memories);

    let phase: AgentPollingResponse['researchState']['phase'] = 'idle';
    if (agentStatus === 'success' || brainStep === 'done') phase = 'done';
    else if (agentStatus === 'failed') phase = 'error';
    else if (
        brainStep === 'think' ||
        brainStep === 'plan' ||
        brainStep === 'use_tool' ||
        brainStep === 'observe' ||
        brainStep === 'final_answer'
    ) {
        phase = brainStep;
    } else {
        const latestPhaseUpdate = updates.find((u) =>
            ['synthesize', 'verify', 'plan', 'domain_search', 'tick', 'goal_completed', 'tool_result'].includes(
                u.updateType
            )
        );
        if (latestPhaseUpdate?.updateType === 'synthesize' || latestPhaseUpdate?.updateType === 'goal_completed') {
            phase = 'final_answer';
        } else if (latestPhaseUpdate?.updateType === 'verify') {
            phase = 'observe';
        } else if (
            latestPhaseUpdate?.updateType === 'domain_search' ||
            latestPhaseUpdate?.updateType === 'tool_result'
        ) {
            phase = 'use_tool';
        } else if (latestPhaseUpdate?.updateType === 'plan') {
            phase = 'plan';
        } else if (agentStatus === 'pending') {
            phase = 'think';
        }
    }

    const verifyUpdate = updates.find((u) => u.updateType === 'verify');
    const verifyPayload = (verifyUpdate?.payload || {}) as Record<string, unknown>;

    const nextStepMem = memories.find((m) => /^next_step_/i.test(m.key));
    let suggestedNextAction: string | null =
        typeof verifyPayload.suggestedNextAction === 'string'
            ? verifyPayload.suggestedNextAction
            : null;
    let suggestedQuery: string | null =
        typeof verifyPayload.suggestedQuery === 'string' ? verifyPayload.suggestedQuery : null;
    if (nextStepMem?.content) {
        try {
            const parsed = JSON.parse(nextStepMem.content) as {
                action?: string;
                query?: string;
            };
            if (!suggestedNextAction && parsed.action) suggestedNextAction = parsed.action;
            if (!suggestedQuery && parsed.query) suggestedQuery = parsed.query;
        } catch {
            /* ignore */
        }
    }

    const briefMem = memories.find((m) => m.key === 'research_brief');
    const researchBriefPreview = briefMem?.content
        ? briefMem.content.slice(0, 280)
        : typeof verifyPayload.researchBrief === 'string'
          ? verifyPayload.researchBrief.slice(0, 280)
          : null;

    const evidenceGaps = Array.isArray(verifyPayload.evidenceGaps)
        ? verifyPayload.evidenceGaps.filter((x): x is string => typeof x === 'string').slice(0, 6)
        : [];

    const lastVerifyVerdict =
        typeof verifyPayload.verdict === 'string' ? verifyPayload.verdict : null;

    let confidence: 'low' | 'medium' | 'high' = 'low';
    if (sourcesSeen.length >= 3 || (briefMem && sourcesSeen.length >= 2)) confidence = 'high';
    else if (sourcesSeen.length >= 2 || Boolean(briefMem)) confidence = 'medium';

    return {
        phase,
        sourcesSeen,
        evidenceGaps,
        suggestedNextAction,
        suggestedQuery,
        researchBriefPreview,
        lastVerifyVerdict,
        confidence,
    };
};

router.post(
    '/agentStatus',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const thread = await ModelChatLlmThread.findOne({
                _id: threadId,
                userId: auth_userId,
            });
            if (!thread) {
                return res.status(404).json({ message: 'Thread not found' });
            }

            if (thread.answerEngine !== 'agent') {
                const empty: AgentPollingResponse = {
                    isProcessing: false,
                    status: 'not_started',
                    brainStep: null,
                    agentInstanceId: null,
                    tickCount: 0,
                    goals: [],
                    updates: [],
                    logs: [],
                    memoryCount: 0,
                    memories: [],
                    tokenUsage: emptyAgentTokenUsage(),
                    memoryStats: emptyAgentMemoryStats(),
                    activeSkillNames: [],
                    researchState: emptyResearchState(),
                };
                return res.status(200).json(empty);
            }

            const latestAgent = await ModelAgentInstance.findOne({
                threadId,
                userId: auth_userId,
            }).sort({ createdAtUtc: -1 });

            if (!latestAgent) {
                const empty: AgentPollingResponse = {
                    isProcessing: false,
                    status: 'not_started',
                    brainStep: null,
                    agentInstanceId: null,
                    tickCount: 0,
                    goals: [],
                    updates: [],
                    logs: [],
                    memoryCount: 0,
                    memories: [],
                    tokenUsage: emptyAgentTokenUsage(),
                    memoryStats: emptyAgentMemoryStats(),
                    activeSkillNames: [],
                    researchState: emptyResearchState(),
                };
                return res.status(200).json(empty);
            }

            const sinceUpdateId = getMongodbObjectOrNull(req.body.sinceUpdateId);
            const sinceLogId = getMongodbObjectOrNull(req.body.sinceLogId);

            const goals = await ModelAgentGoal.find({
                agentInstanceId: latestAgent._id,
            }).sort({ orderIndex: 1 });

            const updateFilter: Record<string, unknown> = {
                agentInstanceId: latestAgent._id,
            };
            if (sinceUpdateId) {
                updateFilter._id = { $gt: sinceUpdateId };
            }

            const updates = await ModelAgentUpdate.find(updateFilter)
                .sort({ createdAtUtc: -1 })
                .limit(sinceUpdateId ? 50 : 20)
                .lean();

            const logFilter: Record<string, unknown> = {
                agentInstanceId: latestAgent._id,
            };
            if (sinceLogId) {
                logFilter._id = { $gt: sinceLogId };
            }

            const logs = await ModelAgentLog.find(logFilter)
                .sort({ createdAtUtc: -1 })
                .limit(sinceLogId ? 150 : 80)
                .lean();

            const [memoryDocs, memoryCount, memoryByTypeAgg] = await Promise.all([
                ModelAgentMemory.find({ agentInstanceId: latestAgent._id })
                    .sort({ createdAtUtc: -1 })
                    .limit(50)
                    .select('key content memoryType createdAtUtc')
                    .lean(),
                ModelAgentMemory.countDocuments({ agentInstanceId: latestAgent._id }),
                ModelAgentMemory.aggregate([
                    { $match: { agentInstanceId: latestAgent._id } },
                    { $group: { _id: '$memoryType', count: { $sum: 1 } } },
                ]),
            ]);
            const byType: Record<string, number> = {};
            for (const row of memoryByTypeAgg) {
                const key = typeof row._id === 'string' && row._id ? row._id : 'other';
                byType[key] = row.count || 0;
            }

            let mappedStatus: 'pending' | 'success' | 'failed' = 'pending';
            if (latestAgent.status === 'success') {
                mappedStatus = 'success';
            } else if (latestAgent.status === 'failed') {
                mappedStatus = 'failed';
            }

            const isProcessing = mappedStatus === 'pending';

            const response: AgentPollingResponse = {
                isProcessing,
                status: mappedStatus,
                brainStep: latestAgent.brainStep ?? null,
                agentInstanceId: String(latestAgent._id),
                tickCount: latestAgent.tickCount || 0,
                goals: goals.map((g) => ({
                    id: String(g._id),
                    title: g.title,
                    description: g.description,
                    status: g.status,
                    result: g.result || '',
                    orderIndex: g.orderIndex,
                    parentGoalId: g.parentGoalId ? String(g.parentGoalId) : null,
                })),
                updates: updates
                    .slice()
                    .reverse()
                    .map((u) => ({
                        id: String(u._id),
                        updateType: u.updateType,
                        message: u.message,
                        tickNumber: u.tickNumber || 0,
                        createdAtUtc: u.createdAtUtc
                            ? new Date(u.createdAtUtc).toISOString()
                            : '',
                        payload: (u.payload as Record<string, unknown>) || {},
                    })),
                logs: logs
                    .slice()
                    .reverse()
                    .map((l) => ({
                        id: String(l._id),
                        level: l.level || 'info',
                        action: l.action || 'other',
                        title: (l.title || l.message || l.action || 'log').slice(0, 200),
                        message: l.message || '',
                        tickNumber: l.tickNumber || 0,
                        createdAtUtc: l.createdAtUtc
                            ? new Date(l.createdAtUtc).toISOString()
                            : '',
                        payload: (l.payload as Record<string, unknown>) || {},
                        raw: l.raw ?? null,
                    })),
                memoryCount,
                memories: memoryDocs
                    .slice()
                    .reverse()
                    .map((m) => ({
                        id: String(m._id),
                        key: m.key || '',
                        memoryType: m.memoryType || 'other',
                        content: (m.content || '').slice(0, 4000),
                        createdAtUtc: m.createdAtUtc
                            ? new Date(m.createdAtUtc).toISOString()
                            : '',
                    })),
                tokenUsage: {
                    prompt: latestAgent.promptTokens || 0,
                    completion: latestAgent.completionTokens || 0,
                    reasoning: latestAgent.reasoningTokens || 0,
                    total: latestAgent.totalTokens || 0,
                    costInUsd: latestAgent.costInUsd || 0,
                    maxPromptPerQuery: latestAgent.maxPromptTokensPerQuery || 0,
                    maxCompletionPerQuery: latestAgent.maxCompletionTokensPerQuery || 0,
                },
                budget: (() => {
                    const status = computeAgentBudgetStatus({
                        totalTokens: latestAgent.totalTokens || 0,
                        tickCount: latestAgent.tickCount || 0,
                        limits: budgetLimitsFromAgentDoc(latestAgent),
                    });
                    const ctx = formatAgentBudgetContext(status);
                    return {
                        tokens: ctx.tokens as {
                            used: number;
                            min: number;
                            max: number;
                            remaining: number;
                            pctUsed: number;
                            pctRemaining: number;
                        },
                        iterations: ctx.iterations as {
                            used: number;
                            min: number;
                            max: number;
                            remaining: number;
                            pctUsed: number;
                            pctRemaining: number;
                        },
                        minsMet: status.minsMet,
                        maxExceeded: status.maxExceeded,
                        nearMax: status.nearMax,
                    };
                })(),
                memoryStats: {
                    total: memoryCount,
                    byType,
                },
                activeSkillNames: Array.isArray(latestAgent.activeSkillNames)
                    ? latestAgent.activeSkillNames
                    : [],
                researchState: buildResearchState({
                    agentStatus: latestAgent.status,
                    brainStep: latestAgent.brainStep,
                    updates: updates.map((u) => ({
                        updateType: u.updateType,
                        payload: (u.payload as Record<string, unknown>) || {},
                    })),
                    memories: memoryDocs.map((m) => ({
                        key: m.key || '',
                        content: m.content || '',
                    })),
                }),
            };

            return res.status(200).json(response);
        } catch (error) {
            console.error('Error in agentStatus polling:', error);
            return res.status(500).json({
                message: 'Server error',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
);

router.post(
    '/agentCancel',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const thread = await ModelChatLlmThread.findOne({
                _id: threadId,
                userId: auth_userId,
            }).select('_id answerEngine');
            if (!thread) {
                return res.status(404).json({ message: 'Thread not found' });
            }
            if (thread.answerEngine !== 'agent') {
                return res.status(400).json({ message: 'Thread is not using Agent' });
            }

            const latestRunning = await ModelAgentInstance.findOne({
                threadId,
                userId: auth_userId,
                status: 'pending',
            }).sort({ createdAtUtc: -1 });

            if (!latestRunning) {
                return res.status(404).json({ message: 'No active Agent run to cancel' });
            }

            await ModelAgentInstance.updateOne(
                { _id: latestRunning._id, userId: auth_userId },
                {
                    $set: {
                        cancellationRequestedUtc: new Date(),
                        status: 'failed',
                        updatedAtUtc: new Date(),
                        tickLockUntilUtc: null,
                    },
                }
            );

            await cancelPendingAgentTickTasks({
                agentInstanceId: latestRunning._id as mongoose.Types.ObjectId,
            });

            await ModelAgentUpdate.create({
                agentInstanceId: latestRunning._id,
                userId: auth_userId,
                threadId,
                updateType: 'status',
                message: 'Agent cancelled by user.',
                payload: {},
                goalId: null,
                tickNumber: latestRunning.tickCount || 0,
                createdAtUtc: new Date(),
            });

            await writeAgentLog({
                agentInstanceId: latestRunning._id as mongoose.Types.ObjectId,
                userId: auth_userId,
                threadId,
                action: 'agent_cancelled',
                message: 'Agent cancelled by user.',
                level: 'warn',
                tickNumber: latestRunning.tickCount || 0,
            });

            await ensureAgentTerminalChatMessage({
                agentInstanceId: latestRunning._id as mongoose.Types.ObjectId,
                userId: auth_userId,
                threadId,
                outcome: 'failed',
                reason: 'Agent cancelled by user.',
            });

            return res.status(200).json({ success: true, message: 'Agent cancelled.' });
        } catch (error) {
            console.error('Error in agentCancel:', error);
            return res.status(500).json({
                message: 'Server error',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
);

router.post(
    '/agentProgressList',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const runningAgents = await ModelAgentInstance.find({
                userId: auth_userId,
                status: 'pending',
            }).sort({ updatedAtUtc: -1 });

            const list = await Promise.all(
                runningAgents.map(async (agent) => {
                    const thread = await ModelChatLlmThread.findById(agent.threadId).select('threadTitle').lean();
                    const goals = await ModelAgentGoal.find({ agentInstanceId: agent._id }).sort({ orderIndex: 1 });
                    const inProgressGoal = goals.find((g) => g.status === 'in_progress') || goals.find((g) => g.status === 'pending');
                    const completedGoalsCount = goals.filter((g) => g.status === 'completed').length;

                    return {
                        agentInstanceId: String(agent._id),
                        threadId: String(agent.threadId),
                        threadTitle: thread?.threadTitle || 'Chat Thread',
                        status: agent.status,
                        tickCount: agent.tickCount || 0,
                        goalsCount: goals.length,
                        completedGoalsCount,
                        currentGoalTitle: inProgressGoal?.title || 'Processing...',
                        lastTickAtUtc: agent.lastTickAtUtc || agent.updatedAtUtc,
                        createdAtUtc: agent.createdAtUtc,
                        totalTokens: agent.totalTokens || 0,
                        costInUsd: agent.costInUsd || 0,
                    };
                })
            );

            return res.status(200).json({
                success: true,
                count: list.length,
                agents: list,
            });
        } catch (error) {
            console.error('agentProgressList error:', error);
            return res.status(500).json({
                success: false,
                message: 'Server error',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
);

export default router;
