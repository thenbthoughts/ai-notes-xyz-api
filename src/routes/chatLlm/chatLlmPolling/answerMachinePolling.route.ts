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
import {
    calculateAgentInstanceUsage,
    calculateAgentInstanceUsageMap,
    calculateAgentThreadUsage,
} from '../chatLlmCrud/agent/agentStats/agentUsageFromLogs';

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
        past: boolean;
    }>;
    memoryCount: number;
    memories: Array<{
        id: string;
        key: string;
        memoryType: string;
        content: string;
        createdAtUtc: string;
        past: boolean;
    }>;
    tokenUsage: {
        prompt: number;
        completion: number;
        reasoning: number;
        total: number;
        costInUsd: number;
        maxPromptPerQuery: number;
        maxCompletionPerQuery: number;
        llmRequestCount: number;
    };
    threadUsage: {
        prompt: number;
        completion: number;
        reasoning: number;
        total: number;
        costInUsd: number;
        maxPromptPerQuery: number;
        maxCompletionPerQuery: number;
        llmRequestCount: number;
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
    instances: Array<{
        id: string;
        status: 'pending' | 'success' | 'failed';
        brainStep: 'think' | 'plan' | 'use_tool' | 'observe' | 'final_answer' | 'done' | null;
        tickCount: number;
        summary: string;
        goalTitle: string;
        errorReason: string;
        createdAtUtc: string;
        updatedAtUtc: string;
        completedAtUtc: string;
        durationMs: number;
        totalTokens: number;
        costInUsd: number;
        llmRequestCount: number;
        usage: {
            prompt: number;
            completion: number;
            reasoning: number;
            total: number;
            costInUsd: number;
            maxPromptPerQuery: number;
            maxCompletionPerQuery: number;
            llmRequestCount: number;
        };
        activeSkillNames: string[];
        memoryByType: Record<string, number>;
        goals: Array<{
            id: string;
            title: string;
            status: string;
            parentGoalId: string | null;
        }>;
        latestUpdate: string;
        isLatest: boolean;
    }>;
}

const emptyAgentTokenUsage = () => ({
    prompt: 0,
    completion: 0,
    reasoning: 0,
    total: 0,
    costInUsd: 0,
    maxPromptPerQuery: 0,
    maxCompletionPerQuery: 0,
    llmRequestCount: 0,
});

const serializeUsage = (usage: {
    prompt: number;
    completion: number;
    reasoning: number;
    total: number;
    costInUsd: number;
    maxPromptPerQuery: number;
    maxCompletionPerQuery: number;
    llmRequestCount: number;
}) => ({
    prompt: usage.prompt,
    completion: usage.completion,
    reasoning: usage.reasoning,
    total: usage.total,
    costInUsd: usage.costInUsd,
    maxPromptPerQuery: usage.maxPromptPerQuery,
    maxCompletionPerQuery: usage.maxCompletionPerQuery,
    llmRequestCount: usage.llmRequestCount,
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

const emptyAgentPollingResponse = (): AgentPollingResponse => ({
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
    threadUsage: emptyAgentTokenUsage(),
    memoryStats: emptyAgentMemoryStats(),
    activeSkillNames: [],
    researchState: emptyResearchState(),
    instances: [],
});

const mapAgentInstanceList = async (
    instanceDocs: Array<{
        _id: unknown;
        status?: string;
        brainStep?: string | null;
        tickCount?: number;
        summary?: string;
        errorReason?: string;
        createdAtUtc?: Date | string | null;
        updatedAtUtc?: Date | string | null;
        completedAtUtc?: Date | string | null;
        totalTokens?: number;
        costInUsd?: number;
        activeSkillNames?: string[];
    }>
): Promise<AgentPollingResponse['instances']> => {
    if (instanceDocs.length === 0) {
        return [];
    }
    const instanceIds = instanceDocs.map((d) => d._id);
    const [allGoals, usageByInstance, memoryByTypeAgg, latestUpdates] = await Promise.all([
        ModelAgentGoal.find({
            agentInstanceId: { $in: instanceIds },
        })
            .sort({ orderIndex: 1 })
            .select('agentInstanceId title status parentGoalId')
            .lean(),
        calculateAgentInstanceUsageMap(instanceIds as Array<mongoose.Types.ObjectId | string>),
        ModelAgentMemory.aggregate([
            { $match: { agentInstanceId: { $in: instanceIds } } },
            {
                $group: {
                    _id: { agentInstanceId: '$agentInstanceId', memoryType: '$memoryType' },
                    count: { $sum: 1 },
                },
            },
        ]),
        ModelAgentUpdate.aggregate([
            { $match: { agentInstanceId: { $in: instanceIds } } },
            { $sort: { createdAtUtc: -1 } },
            { $group: { _id: '$agentInstanceId', message: { $first: '$message' } } },
        ]),
    ]);

    const goalsByInstance = new Map<
        string,
        Array<{ id: string; title: string; status: string; parentGoalId: string | null }>
    >();
    const goalTitleByInstance = new Map<string, string>();
    for (const goal of allGoals) {
        const key = String(goal.agentInstanceId);
        const row = {
            id: String(goal._id),
            title: goal.title || '',
            status: goal.status || 'pending',
            parentGoalId: goal.parentGoalId ? String(goal.parentGoalId) : null,
        };
        const list = goalsByInstance.get(key) || [];
        list.push(row);
        goalsByInstance.set(key, list);
        if (!row.parentGoalId && row.title && !goalTitleByInstance.has(key)) {
            goalTitleByInstance.set(key, row.title);
        }
    }

    const memoryByInstance = new Map<string, Record<string, number>>();
    for (const row of memoryByTypeAgg) {
        const key = String(row._id?.agentInstanceId || '');
        if (!key) continue;
        const type =
            typeof row._id?.memoryType === 'string' && row._id.memoryType
                ? row._id.memoryType
                : 'other';
        const current = memoryByInstance.get(key) || {};
        current[type] = row.count || 0;
        memoryByInstance.set(key, current);
    }

    const latestByInstance = new Map<string, string>();
    for (const row of latestUpdates) {
        latestByInstance.set(String(row._id), (row.message || '').slice(0, 240));
    }

    return instanceDocs.map((doc, index) => {
        const id = String(doc._id);
        const status =
            doc.status === 'success' || doc.status === 'failed' ? doc.status : 'pending';
        const brainStep =
            doc.brainStep === 'think' ||
            doc.brainStep === 'plan' ||
            doc.brainStep === 'use_tool' ||
            doc.brainStep === 'observe' ||
            doc.brainStep === 'final_answer' ||
            doc.brainStep === 'done'
                ? doc.brainStep
                : null;
        const startedAt = doc.createdAtUtc ? new Date(doc.createdAtUtc) : null;
        const completedAt = doc.completedAtUtc ? new Date(doc.completedAtUtc) : null;
        const endedAt =
            completedAt ||
            (status !== 'pending' && doc.updatedAtUtc ? new Date(doc.updatedAtUtc) : null);
        const startMs = startedAt ? startedAt.getTime() : 0;
        const endMs = endedAt ? endedAt.getTime() : status === 'pending' ? Date.now() : 0;
        const durationMs = startMs > 0 && endMs >= startMs ? endMs - startMs : 0;
        const usage = usageByInstance.get(id) || {
            prompt: 0,
            completion: 0,
            reasoning: 0,
            total: 0,
            costInUsd: 0,
            maxPromptPerQuery: 0,
            maxCompletionPerQuery: 0,
            llmRequestCount: 0,
        };
        return {
            id,
            status,
            brainStep,
            tickCount: doc.tickCount || 0,
            summary: (doc.summary || '').slice(0, 400),
            goalTitle: goalTitleByInstance.get(id) || '',
            errorReason: doc.errorReason || '',
            createdAtUtc: startedAt ? startedAt.toISOString() : '',
            updatedAtUtc: doc.updatedAtUtc ? new Date(doc.updatedAtUtc).toISOString() : '',
            completedAtUtc: endedAt ? endedAt.toISOString() : '',
            durationMs,
            totalTokens: usage.total,
            costInUsd: usage.costInUsd,
            llmRequestCount: usage.llmRequestCount,
            usage: {
                prompt: usage.prompt,
                completion: usage.completion,
                reasoning: usage.reasoning,
                total: usage.total,
                costInUsd: usage.costInUsd,
                maxPromptPerQuery: usage.maxPromptPerQuery,
                maxCompletionPerQuery: usage.maxCompletionPerQuery,
                llmRequestCount: usage.llmRequestCount,
            },
            activeSkillNames: Array.isArray(doc.activeSkillNames) ? doc.activeSkillNames : [],
            memoryByType: memoryByInstance.get(id) || {},
            goals: goalsByInstance.get(id) || [],
            latestUpdate: latestByInstance.get(id) || '',
            isLatest: index === 0,
        };
    });
};

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
                return res.status(200).json(emptyAgentPollingResponse());
            }

            const instanceDocs = await ModelAgentInstance.find({
                threadId,
                userId: auth_userId,
            })
                .sort({ createdAtUtc: -1 })
                .limit(40)
                .lean();

            if (instanceDocs.length === 0) {
                return res.status(200).json(emptyAgentPollingResponse());
            }

            const latestAgent = instanceDocs[0];
            const requestedId = getMongodbObjectOrNull(req.body.agentInstanceId);
            let selectedAgent = latestAgent;
            if (requestedId) {
                const fromList = instanceDocs.find((doc) => String(doc._id) === String(requestedId));
                if (fromList) {
                    selectedAgent = fromList;
                } else {
                    const found = await ModelAgentInstance.findOne({
                        _id: requestedId,
                        threadId,
                        userId: auth_userId,
                    }).lean();
                    if (found) {
                        selectedAgent = found;
                    }
                }
            }

            const instances = await mapAgentInstanceList(instanceDocs);

            const sinceUpdateId = getMongodbObjectOrNull(req.body.sinceUpdateId);
            const sinceLogId = getMongodbObjectOrNull(req.body.sinceLogId);

            const goals = await ModelAgentGoal.find({
                agentInstanceId: selectedAgent._id,
            }).sort({ orderIndex: 1 });

            const updateFilter: Record<string, unknown> = {
                agentInstanceId: selectedAgent._id,
            };
            if (sinceUpdateId) {
                updateFilter._id = { $gt: sinceUpdateId };
            }

            const updates = await ModelAgentUpdate.find(updateFilter)
                .sort({ createdAtUtc: -1 })
                .limit(sinceUpdateId ? 50 : 20)
                .lean();

            const logFilter: Record<string, unknown> = {
                agentInstanceId: selectedAgent._id,
            };
            if (sinceLogId) {
                logFilter._id = { $gt: sinceLogId };
            }

            const logs = await ModelAgentLog.find(logFilter)
                .sort({ createdAtUtc: -1 })
                .limit(sinceLogId ? 150 : 80)
                .lean();

            const [memoryDocs, memoryCount, memoryByTypeAgg, selectedUsage, threadUsage] =
                await Promise.all([
                    ModelAgentMemory.find({ agentInstanceId: selectedAgent._id })
                        .sort({ createdAtUtc: -1 })
                        .limit(50)
                        .select('key content memoryType createdAtUtc past')
                        .lean(),
                    ModelAgentMemory.countDocuments({ agentInstanceId: selectedAgent._id }),
                    ModelAgentMemory.aggregate([
                        { $match: { agentInstanceId: selectedAgent._id } },
                        { $group: { _id: '$memoryType', count: { $sum: 1 } } },
                    ]),
                    calculateAgentInstanceUsage(selectedAgent._id as mongoose.Types.ObjectId),
                    calculateAgentThreadUsage(threadId),
                ]);
            const byType: Record<string, number> = {};
            for (const row of memoryByTypeAgg) {
                const key = typeof row._id === 'string' && row._id ? row._id : 'other';
                byType[key] = row.count || 0;
            }

            let mappedStatus: 'pending' | 'success' | 'failed' = 'pending';
            if (selectedAgent.status === 'success') {
                mappedStatus = 'success';
            } else if (selectedAgent.status === 'failed') {
                mappedStatus = 'failed';
            }

            const isProcessing =
                mappedStatus === 'pending' ||
                instances.some((item) => item.status === 'pending');

            const response: AgentPollingResponse = {
                isProcessing,
                status: mappedStatus,
                brainStep: selectedAgent.brainStep ?? null,
                agentInstanceId: String(selectedAgent._id),
                tickCount: selectedAgent.tickCount || 0,
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
                        past: Boolean(l.past),
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
                        past: Boolean(m.past),
                    })),
                tokenUsage: serializeUsage(selectedUsage),
                threadUsage: serializeUsage(threadUsage),
                budget: (() => {
                    const status = computeAgentBudgetStatus({
                        totalTokens: selectedUsage.total,
                        tickCount: selectedAgent.tickCount || 0,
                        limits: budgetLimitsFromAgentDoc(selectedAgent),
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
                activeSkillNames: Array.isArray(selectedAgent.activeSkillNames)
                    ? selectedAgent.activeSkillNames
                    : [],
                researchState: buildResearchState({
                    agentStatus: selectedAgent.status,
                    brainStep: selectedAgent.brainStep,
                    updates: updates.map((u) => ({
                        updateType: u.updateType,
                        payload: (u.payload as Record<string, unknown>) || {},
                    })),
                    memories: memoryDocs.map((m) => ({
                        key: m.key || '',
                        content: m.content || '',
                    })),
                }),
                instances,
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

const loadAgentInstanceDetail = async (selectedAgent: {
    _id: unknown;
    status?: string;
    brainStep?: string | null;
    tickCount?: number;
    activeSkillNames?: string[];
    minBudgetTokens?: number;
    maxBudgetTokens?: number;
    minNumberOfIterations?: number;
    maxNumberOfIterations?: number;
}) => {
    const goals = await ModelAgentGoal.find({
        agentInstanceId: selectedAgent._id,
    }).sort({ orderIndex: 1 });

    const updates = await ModelAgentUpdate.find({
        agentInstanceId: selectedAgent._id,
    })
        .sort({ createdAtUtc: -1 })
        .limit(20)
        .lean();

    const logs = await ModelAgentLog.find({
        agentInstanceId: selectedAgent._id,
    })
        .sort({ createdAtUtc: -1 })
        .limit(80)
        .lean();

    const [memoryDocs, memoryCount, memoryByTypeAgg, selectedUsage] = await Promise.all([
        ModelAgentMemory.find({ agentInstanceId: selectedAgent._id })
            .sort({ createdAtUtc: -1 })
            .limit(50)
            .select('key content memoryType createdAtUtc past')
            .lean(),
        ModelAgentMemory.countDocuments({ agentInstanceId: selectedAgent._id }),
        ModelAgentMemory.aggregate([
            { $match: { agentInstanceId: selectedAgent._id } },
            { $group: { _id: '$memoryType', count: { $sum: 1 } } },
        ]),
        calculateAgentInstanceUsage(selectedAgent._id as mongoose.Types.ObjectId),
    ]);

    const byType: Record<string, number> = {};
    for (const row of memoryByTypeAgg) {
        const key = typeof row._id === 'string' && row._id ? row._id : 'other';
        byType[key] = row.count || 0;
    }

    let mappedStatus: 'pending' | 'success' | 'failed' = 'pending';
    if (selectedAgent.status === 'success') {
        mappedStatus = 'success';
    } else if (selectedAgent.status === 'failed') {
        mappedStatus = 'failed';
    }

    const budgetStatus = computeAgentBudgetStatus({
        totalTokens: selectedUsage.total,
        tickCount: selectedAgent.tickCount || 0,
        limits: budgetLimitsFromAgentDoc(selectedAgent),
    });
    const budgetCtx = formatAgentBudgetContext(budgetStatus);

    return {
        agentInstanceId: String(selectedAgent._id),
        status: mappedStatus,
        brainStep: selectedAgent.brainStep ?? null,
        tickCount: selectedAgent.tickCount || 0,
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
                createdAtUtc: u.createdAtUtc ? new Date(u.createdAtUtc).toISOString() : '',
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
                createdAtUtc: l.createdAtUtc ? new Date(l.createdAtUtc).toISOString() : '',
                payload: (l.payload as Record<string, unknown>) || {},
                raw: l.raw ?? null,
                past: Boolean(l.past),
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
                createdAtUtc: m.createdAtUtc ? new Date(m.createdAtUtc).toISOString() : '',
                past: Boolean(m.past),
            })),
        tokenUsage: serializeUsage(selectedUsage),
        budget: {
            tokens: budgetCtx.tokens as {
                used: number;
                min: number;
                max: number;
                remaining: number;
                pctUsed: number;
                pctRemaining: number;
            },
            iterations: budgetCtx.iterations as {
                used: number;
                min: number;
                max: number;
                remaining: number;
                pctUsed: number;
                pctRemaining: number;
            },
            minsMet: budgetStatus.minsMet,
            maxExceeded: budgetStatus.maxExceeded,
            nearMax: budgetStatus.nearMax,
        },
        memoryStats: {
            total: memoryCount,
            byType,
        },
        activeSkillNames: Array.isArray(selectedAgent.activeSkillNames)
            ? selectedAgent.activeSkillNames
            : [],
        researchState: buildResearchState({
            agentStatus: selectedAgent.status || 'pending',
            brainStep: selectedAgent.brainStep,
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
};

router.post(
    '/agentInstanceList',
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
                return res.status(200).json({
                    instances: [],
                    threadUsage: emptyAgentTokenUsage(),
                });
            }

            const instanceDocs = await ModelAgentInstance.find({
                threadId,
                userId: auth_userId,
            })
                .sort({ createdAtUtc: -1 })
                .limit(40)
                .lean();

            const [instances, threadUsage] = await Promise.all([
                mapAgentInstanceList(instanceDocs),
                calculateAgentThreadUsage(threadId),
            ]);

            return res.status(200).json({
                instances,
                threadUsage: serializeUsage(threadUsage),
            });
        } catch (error) {
            console.error('Error in agentInstanceList:', error);
            return res.status(500).json({
                message: 'Server error',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
);

router.post(
    '/agentInstanceById',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            const agentInstanceId = getMongodbObjectOrNull(req.body.agentInstanceId);
            if (threadId === null || agentInstanceId === null) {
                return res.status(400).json({ message: 'Thread ID and instance ID are required' });
            }

            const selectedAgent = await ModelAgentInstance.findOne({
                _id: agentInstanceId,
                threadId,
                userId: auth_userId,
            }).lean();
            if (!selectedAgent) {
                return res.status(404).json({ message: 'Agent instance not found' });
            }

            const detail = await loadAgentInstanceDetail(selectedAgent);
            return res.status(200).json(detail);
        } catch (error) {
            console.error('Error in agentInstanceById:', error);
            return res.status(500).json({
                message: 'Server error',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
);

export default router;
