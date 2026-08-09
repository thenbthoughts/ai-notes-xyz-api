import mongoose from 'mongoose';
import axios from 'axios';

import { ModelChatLlm } from '../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAgentInstance } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { IAgentGoal } from '../../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentGoal.types';
import { IAgentInstance } from '../../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentInstance.types';
import { ModelAgentMemory } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentUpdate } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelAgentLog } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentLog.schema';
import { ModelUserApiKey } from '../../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../../utils/llm/llmCommonFunc';
import { getLlmConfig } from '../../chatUtils/chatLlmGetLlmConfig';
import { agentTaskFilesDir, getAgentShellConfig } from '../agentUtils/agentShell/agentShellWorkspace';
import syncThreadUploadsToAgentWorkspace from '../agentUtils/agentSyncUploads';
import writeAgentLog, { type AgentLogContext } from '../agentUtils/agentWriteLog';
import { defaultAgentToolRegistry, writeUpdate } from './agentToolRegistry';
import {
    applyArtifactGate,
    applyEvidenceGate,
    detectSourcesSeenInMemory,
    formatMemorySummary,
    listWorkspaceDeliverables,
    filterNewDeliverables,
    planAgentStep,
    synthesizeAgentAnswer,
    verifyAgentStep,
    type AgentPlanDecision,
} from './agentPlanVerify';
import {
    expansionExpectsWorkspaceFile,
    formatChildResultsPack,
    formatExpansionForPrompt,
    loadGoalExpansion,
} from '../agentPlan/agentGoalExpand';
import {
    type AgentBrainStep,
} from '../agentUtils/agentBrainStep';
import {
    formatActiveSkillsBlock,
    listEnabledSkillsForUser,
    resolveSkillsToLoad,
} from '../../agentSkills/agentSkillsLib';
import { persistAgentFinalWithCitations } from './agentFinalPersist';
import {
    agentRunTag,
    ensureAgentTerminalChatMessage,
} from '../agentUtils/ensureAgentTerminalChatMessage';
import {
    budgetLimitsFromAgentDoc,
    computeAgentBudgetStatus,
    formatAgentBudgetContext,
} from '../agentStats/agentBudget';

type AgentCitation = {
    source: string;
    id: string;
    title: string;
    summary: string;
};

const toId = (id: mongoose.Types.ObjectId | string): mongoose.Types.ObjectId =>
    typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;

const loadAgent = async (agentRunId: mongoose.Types.ObjectId | string): Promise<IAgentInstance> => {
    const agent = await ModelAgentInstance.findById(toId(agentRunId));
    if (!agent) {
        throw new Error(`Agent run not found: ${String(agentRunId)}`);
    }
    return agent;
};

const loadCurrentGoal = async (
    agentRunId: mongoose.Types.ObjectId
): Promise<IAgentGoal | null> => {
    const goals = await ModelAgentGoal.find({ agentInstanceId: agentRunId }).sort({
        orderIndex: 1,
        createdAtUtc: 1,
    });

    // Prefer leaf work: pending/in_progress goals that have no unfinished children.
    const open = goals.filter((g) => g.status === 'in_progress' || g.status === 'pending');
    for (const g of open) {
        const children = goals.filter(
            (c) => c.parentGoalId && String(c.parentGoalId) === String(g._id)
        );
        if (children.length === 0) {
            return g;
        }
        const unfinished = children.filter(
            (c) => c.status === 'pending' || c.status === 'in_progress'
        );
        if (unfinished.length > 0) {
            // Work a child first
            const childOpen = unfinished.find((c) => c.status === 'in_progress') || unfinished[0];
            return childOpen;
        }
        // All children done — promote parent if still open
        return g;
    }
    return null;
};

/** Parents with finished children stay open so the parent can run with a child-results pack. */
const writeChildResultIntoParentContext = async (params: {
    agentRunId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    completedGoal: IAgentGoal;
}): Promise<void> => {
    const { agentRunId, userId, threadId, completedGoal } = params;
    if (!completedGoal.parentGoalId) return;

    const childId = String(completedGoal._id);
    const now = new Date();
    const childPayload = {
        goalId: childId,
        title: completedGoal.title,
        description: completedGoal.description || '',
        status: completedGoal.status,
        result: (completedGoal.result || '').slice(0, 8000),
        completedAtUtc: completedGoal.completedAtUtc || now,
    };

    await ModelAgentMemory.findOneAndUpdate(
        {
            agentInstanceId: agentRunId,
            key: `child_result_${childId}`,
        },
        {
            $set: {
                userId,
                threadId,
                content: JSON.stringify(childPayload).slice(0, 12000),
                memoryType: 'result',
                updatedAtUtc: now,
            },
            $setOnInsert: { createdAtUtc: now },
        },
        { upsert: true }
    );

    const siblings = await ModelAgentGoal.find({
        agentInstanceId: agentRunId,
        parentGoalId: completedGoal.parentGoalId,
    }).sort({ orderIndex: 1 });

    const pack = formatChildResultsPack(
        siblings.map((s) => ({
            _id: s._id,
            title: s.title,
            description: s.description,
            status: s.status,
            result: s.result,
        }))
    );

    await ModelAgentMemory.findOneAndUpdate(
        {
            agentInstanceId: agentRunId,
            key: `parent_context_${String(completedGoal.parentGoalId)}`,
        },
        {
            $set: {
                userId,
                threadId,
                content: pack,
                memoryType: 'result',
                updatedAtUtc: now,
            },
            $setOnInsert: { createdAtUtc: now },
        },
        { upsert: true }
    );
};

const loadChildResultsPackForGoal = async (
    agentRunId: mongoose.Types.ObjectId,
    goal: IAgentGoal
): Promise<string> => {
    const children = await ModelAgentGoal.find({
        agentInstanceId: agentRunId,
        parentGoalId: goal._id,
    }).sort({ orderIndex: 1 });
    if (children.length === 0) return '';

    const mem = await ModelAgentMemory.findOne({
        agentInstanceId: agentRunId,
        key: `parent_context_${String(goal._id)}`,
    });
    if (mem?.content) return mem.content.slice(0, 12000);

    return formatChildResultsPack(
        children.map((s) => ({
            _id: s._id,
            title: s.title,
            description: s.description,
            status: s.status,
            result: s.result,
        }))
    );
};

const collectCitationsFromMemories = (
    memories: Array<{ key: string; content: string }>
): AgentCitation[] => {
    const out: AgentCitation[] = [];
    const seen = new Set<string>();
    for (const m of memories) {
        if (!/^citation_/i.test(m.key)) continue;
        try {
            const parsed = JSON.parse(m.content) as AgentCitation;
            if (!parsed?.source || !parsed?.id) continue;
            const k = `${parsed.source}:${parsed.id}`;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push({
                source: String(parsed.source),
                id: String(parsed.id),
                title: String(parsed.title || '').slice(0, 200),
                summary: String(parsed.summary || '').slice(0, 400),
            });
        } catch {
            /* ignore */
        }
    }
    return out.slice(0, 24);
};

/**
 * Claim the agent run for one isolated tick. Increments tickCount.
 * Returns false if another worker holds the lock or run is not pending.
 * Recovers stale locks (hung shell / crashed worker) after 5 minutes.
 */
export const agentTickClaim = async (
    agentRunId: mongoose.Types.ObjectId | string
): Promise<boolean> => {
    const now = new Date();
    const id = toId(agentRunId);
    const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
    await ModelAgentInstance.updateOne(
        {
            _id: id,
            status: 'pending',
            statusIsRunning: true,
            updatedAtUtc: { $lt: staleBefore },
        },
        {
            $set: {
                statusIsRunning: false,
                updatedAtUtc: now,
            },
        }
    );

    const agent = await ModelAgentInstance.findOneAndUpdate(
        {
            _id: id,
            status: 'pending',
            statusIsRunning: false,
            cancellationRequestedUtc: null,
        },
        {
            $set: {
                statusIsRunning: true,
                updatedAtUtc: now,
            },
            $inc: { tickCount: 1 },
        },
        { new: true }
    );
    return Boolean(agent);
};

/** If cancellation was requested, fail the run and post a terminal message. */
export const agentTickHandleCancel = async (
    agentRunId: mongoose.Types.ObjectId | string
): Promise<boolean> => {
    const agent = await loadAgent(agentRunId);
    if (!agent.cancellationRequestedUtc) {
        return false;
    }

    const id = agent._id as mongoose.Types.ObjectId;
    await ModelAgentInstance.findByIdAndUpdate(id, {
        $set: {
            status: 'failed',
            brainStep: 'done',
            statusIsRunning: false,
            updatedAtUtc: new Date(),
        },
    });
    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'status',
        message: 'Agent stopped upon user request.',
        tickNumber: agent.tickCount || 0,
        payload: { brainStep: 'done' },
    });
    await writeAgentLog({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        action: 'agent_stopped',
        message: 'Agent stopped upon user request.',
        tickNumber: agent.tickCount || 0,
    });
    await ensureAgentTerminalChatMessage({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        outcome: 'failed',
        reason: 'Agent stopped upon user request.',
    });
    return true;
};

/** If no open goals remain, mark success and post terminal message. */
export const agentTickFinishIfDone = async (
    agentRunId: mongoose.Types.ObjectId | string
): Promise<boolean> => {
    const agent = await loadAgent(agentRunId);
    const id = agent._id as mongoose.Types.ObjectId;
    const goals = await ModelAgentGoal.find({ agentInstanceId: id }).sort({ orderIndex: 1 });
    const currentGoal = goals.find((g) => g.status === 'in_progress' || g.status === 'pending');
    if (currentGoal) {
        return false;
    }

    const budget = computeAgentBudgetStatus({
        totalTokens: agent.totalTokens || 0,
        tickCount: agent.tickCount || 0,
        limits: budgetLimitsFromAgentDoc(agent),
    });

    const completedCount = goals.filter((g) => g.status === 'completed').length;
    const summary = `Completed ${completedCount} of ${goals.length} goals.`;
    await ModelAgentInstance.findByIdAndUpdate(id, {
        $set: {
            status: 'success',
            brainStep: 'done',
            statusIsRunning: false,
            summary: summary.slice(0, 4000),
            lastTickAtUtc: new Date(),
            updatedAtUtc: new Date(),
        },
    });
    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'status',
        message: 'All goals completed. Agent finished.',
        tickNumber: agent.tickCount || 0,
        payload: { brainStep: 'done' },
    });
    await writeAgentLog({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        action: 'agent_completed',
        message: 'All goals completed. Agent finished.',
        tickNumber: agent.tickCount || 0,
        payload: { summary, budget: formatAgentBudgetContext(budget) },
    });
    await ensureAgentTerminalChatMessage({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        outcome: 'success',
        reason: summary,
    });
    return true;
};

/** Start pending goal + optional personal-research skill auto-load. */
export const agentTickPrepareGoal = async (
    agentRunId: mongoose.Types.ObjectId | string
): Promise<void> => {
    const agent = await loadAgent(agentRunId);
    const id = agent._id as mongoose.Types.ObjectId;
    const tickNumber = agent.tickCount || 0;
    const currentGoal = await loadCurrentGoal(id);
    if (!currentGoal) {
        throw new Error('No current goal for tick prepare');
    }

    if (currentGoal.status === 'pending') {
        currentGoal.status = 'in_progress';
        currentGoal.updatedAtUtc = new Date();
        await currentGoal.save();

        await writeUpdate({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'goal_started',
            message: `Started goal: ${currentGoal.title}`,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
        });
        await writeAgentLog({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            action: 'goal_started',
            title: `Started goal: ${currentGoal.title}`,
            message: `Started goal: ${currentGoal.title}`,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
        });

        const expansion = await loadGoalExpansion(currentGoal._id as mongoose.Types.ObjectId);

        if (expansion?.requiresShell) {
            const thread = await ModelChatLlmThread.findById(agent.threadId).select('executeShell').lean();
            if (!thread?.executeShell) {
                currentGoal.status = 'failed';
                currentGoal.result =
                    'Shell/code execution is disabled for this thread. Enable “Allow shell / code execution” in Thread Settings, then retry.';
                currentGoal.updatedAtUtc = new Date();
                await currentGoal.save();
                await writeUpdate({
                    agentInstanceId: id,
                    userId: agent.userId,
                    threadId: agent.threadId,
                    updateType: 'error',
                    message: 'Goal blocked — enable shell execution in thread settings.',
                    goalId: currentGoal._id as mongoose.Types.ObjectId,
                    tickNumber,
                    payload: { consentRequired: true },
                });
                await writeAgentLog({
                    agentInstanceId: id,
                    userId: agent.userId,
                    threadId: agent.threadId,
                    action: 'goal_failed',
                    title: `Failed goal: ${currentGoal.title}`,
                    message: currentGoal.result,
                    goalId: currentGoal._id as mongoose.Types.ObjectId,
                    tickNumber,
                    level: 'error',
                });
                await ModelAgentInstance.findByIdAndUpdate(id, {
                    $set: {
                        status: 'failed',
                        statusIsRunning: false,
                        errorReason: currentGoal.result,
                        updatedAtUtc: new Date(),
                    },
                });
                await ensureAgentTerminalChatMessage({
                    agentInstanceId: id,
                    userId: agent.userId,
                    threadId: agent.threadId,
                    outcome: 'failed',
                    reason: currentGoal.result,
                });
                throw new Error('shell_consent_required');
            }
        }

        const skillBodiesEarly = await listEnabledSkillsForUser(agent.userId);
        const wantedFromExpansion = [
            ...(Array.isArray(agent.activeSkillNames) ? agent.activeSkillNames : []),
            ...(expansion?.suggestedSkills || []),
            ...(expansion?.requiresShell ? ['shell-environment'] : []),
            ...(expansion?.requiresPersonalData ? ['personal-research'] : []),
        ];
        const loaded = resolveSkillsToLoad(skillBodiesEarly, wantedFromExpansion);
        if (loaded.length > 0) {
            const nextNames = Array.from(
                new Set([
                    ...(Array.isArray(agent.activeSkillNames) ? agent.activeSkillNames : []),
                    ...loaded.map((s) => s.name),
                ])
            ).slice(0, 6);
            await ModelAgentInstance.findByIdAndUpdate(id, {
                $set: { activeSkillNames: nextNames, updatedAtUtc: new Date() },
            });
            await writeUpdate({
                agentInstanceId: id,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'skills_loaded',
                message: `Skills loaded: ${nextNames.join(', ')}`,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
                payload: {
                    skills: nextNames,
                    auto: true,
                    fromExpansion: true,
                    outputFormat: expansion?.outputFormat || '',
                },
            });
        }
    }

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'tick',
        message: `Tick ${tickNumber} started`,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
    });

    await syncThreadUploadsToAgentWorkspace({
        userId: agent.userId,
        threadId: agent.threadId,
        logCtx: {
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
        },
    });
};

const loadOrInitWorkspaceBaseline = async (
    agent: IAgentInstance,
    listing: Array<{ relativePath: string; pathInAgentFolder?: string; isDir?: boolean; size?: number }>
): Promise<Set<string>> => {
    const id = agent._id as mongoose.Types.ObjectId;
    const existing = await ModelAgentMemory.findOne({
        agentInstanceId: id,
        key: 'workspace_baseline_files',
    }).lean();

    const listingPaths = (listing || [])
        .filter((f) => f && !f.isDir && (f.size || 0) > 0)
        .flatMap((f) => {
            const rel = String(f.relativePath || '').replace(/\\/g, '/');
            const short = String(f.pathInAgentFolder || rel.split('/').pop() || '').replace(/\\/g, '/');
            return [rel, short].filter(Boolean);
        });

    if (existing?.content) {
        try {
            const parsed = JSON.parse(existing.content);
            if (Array.isArray(parsed)) {
                const base = new Set(parsed.map((p) => String(p).replace(/\\/g, '/').toLowerCase()));
                // Empty baseline locked before fixture uploads synced — refresh with uploads/ only.
                // Never absorb agent-created outputs into the baseline (that hides deliverables).
                if (base.size === 0 && listingPaths.length > 0) {
                    const uploadOnly = listingPaths.filter(
                        (p) => /(^|\/)uploads\//i.test(p)
                    );
                    if (uploadOnly.length === 0) {
                        return base;
                    }
                    const now = new Date();
                    await ModelAgentMemory.findOneAndUpdate(
                        { agentInstanceId: id, key: 'workspace_baseline_files' },
                        {
                            $set: {
                                userId: agent.userId,
                                threadId: agent.threadId,
                                content: JSON.stringify(uploadOnly).slice(0, 12000),
                                memoryType: 'fact',
                                updatedAtUtc: now,
                            },
                            $setOnInsert: { createdAtUtc: now },
                        },
                        { upsert: true }
                    );
                    return new Set(uploadOnly.map((p) => p.toLowerCase()));
                }
                return base;
            }
        } catch {
            /* fall through */
        }
    }

    const now = new Date();
    await ModelAgentMemory.findOneAndUpdate(
        { agentInstanceId: id, key: 'workspace_baseline_files' },
        {
            $set: {
                userId: agent.userId,
                threadId: agent.threadId,
                content: JSON.stringify(listingPaths).slice(0, 12000),
                memoryType: 'fact',
                updatedAtUtc: now,
            },
            $setOnInsert: { createdAtUtc: now },
        },
        { upsert: true }
    );
    return new Set(listingPaths.map((p) => p.toLowerCase()));
};

const loadShellListing = async (agent: IAgentInstance) => {
    const agentShellDir = agentTaskFilesDir(String(agent.threadId));
    let shellWorkspaceListing: {
        relativePath: string;
        pathInAgentFolder?: string;
        absolutePath: string;
        isDir: boolean;
        size: number;
    }[] = [];
    let containerWorkingDir = '/app/data/ai-notes-xyz-shell-files';
    let agentFolderAbsolutePath = `/app/data/${agentShellDir}`;

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
                    const body = shellRes.data as Record<string, unknown>;
                    const rawList = body.files;
                    if (Array.isArray(rawList)) {
                        shellWorkspaceListing = rawList
                            .map((item) => {
                                if (!item || typeof item !== 'object') return null;
                                const o = item as Record<string, unknown>;
                                const rel =
                                    typeof o.relativePath === 'string'
                                        ? o.relativePath.replace(/\\/g, '/')
                                        : '';
                                if (!rel) return null;
                                if (
                                    /\b(node_modules|\.git|venv|site-packages|__pycache__)\b/i.test(rel) ||
                                    /package-lock\.json$/i.test(rel) ||
                                    /\/venv[_/]/i.test(rel)
                                ) {
                                    return null;
                                }
                                const abs =
                                    typeof o.absolutePath === 'string' && o.absolutePath.trim()
                                        ? o.absolutePath.replace(/\\/g, '/')
                                        : `/app/data/${rel}`;
                                if (abs.includes('/agent/')) {
                                    const idx = abs.indexOf('/agent/');
                                    containerWorkingDir = abs.slice(0, idx);
                                    agentFolderAbsolutePath = abs.slice(
                                        0,
                                        idx + `/agent/${agent.threadId}`.length
                                    );
                                } else if (abs.includes('/ai-notes-xyz-shell-files/')) {
                                    const idx = abs.indexOf('/ai-notes-xyz-shell-files/');
                                    containerWorkingDir = abs.slice(
                                        0,
                                        idx + '/ai-notes-xyz-shell-files'.length
                                    );
                                }
                                const folderIdx = rel.indexOf(`${agentShellDir}/`);
                                const pathInAgentFolder =
                                    folderIdx !== -1
                                        ? rel.slice(folderIdx + agentShellDir.length + 1)
                                        : rel;
                                return {
                                    relativePath: rel,
                                    pathInAgentFolder,
                                    absolutePath: abs,
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

    return { shellWorkspaceListing, containerWorkingDir, agentFolderAbsolutePath };
};

/**
 * PLAN stage: expand top-level goals (and depth-1 children), then enter WORK.
 */
export const agentTickPlanStage = async (
    agentRunId: mongoose.Types.ObjectId | string
): Promise<void> => {
    const agent = await loadAgent(agentRunId);
    const id = agent._id as mongoose.Types.ObjectId;
    const tickNumber = agent.tickCount || 0;
    const userReqMem = await ModelAgentMemory.findOne({
        agentInstanceId: id,
        key: 'user_request',
    });
    const planCtxMem = await ModelAgentMemory.findOne({
        agentInstanceId: id,
        key: 'plan_context',
    });
    const { expandGoalsInPlanStage } = await import('../agentPlan/expandGoals');
    await expandGoalsInPlanStage({
        agent,
        logCtx: {
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            tickNumber,
        },
        userRequest: userReqMem?.content || '',
        planContext: planCtxMem?.content || '',
        isReplan: false,
    });
    await ModelAgentInstance.findByIdAndUpdate(id, {
        $set: {
            brainStep: 'plan',
            updatedAtUtc: new Date(),
        },
    });
};

/**
 * Work-stage decision for this tick. Persists on a `plan` update (handoff via DB).
 * Returns work mode kind.
 */
export const agentTickPlan = async (
    agentRunId: mongoose.Types.ObjectId | string
): Promise<'final_answer' | 'use_tool' | 'expand_goals'> => {
    const agent = await loadAgent(agentRunId);
    const id = agent._id as mongoose.Types.ObjectId;
    const tickNumber = agent.tickCount || 0;
    const currentGoal = await loadCurrentGoal(id);
    if (!currentGoal) {
        throw new Error('No current goal for plan');
    }

    const llmConfig = await getLlmConfig({ threadId: agent.threadId });
    if (!llmConfig) {
        throw new Error('No LLM config available for agent tick');
    }

    const goals = await ModelAgentGoal.find({ agentInstanceId: id }).sort({ orderIndex: 1 });
    const pastGoalResults = goals.map((g) => ({
        orderIndex: g.orderIndex,
        title: g.title,
        status: g.status,
        result: g.result || '(none)',
    }));

    const recentLogDocs = await ModelAgentLog.find({ agentInstanceId: id })
        .sort({ createdAtUtc: -1 })
        .limit(50);
    const last50Logs = recentLogDocs.reverse().map((l) => ({
        tick: l.tickNumber,
        action: l.action,
        title: l.title,
        message: l.message.slice(0, 400),
        level: l.level,
    }));

    const memories = await ModelAgentMemory.find({ agentInstanceId: id })
        .sort({ createdAtUtc: -1 })
        .limit(25);
    const recentUpdates = await ModelAgentUpdate.find({ agentInstanceId: id })
        .sort({ createdAtUtc: -1 })
        .limit(12);

    const memorySummary = formatMemorySummary(
        memories.map((m) => ({ key: m.key, memoryType: m.memoryType, content: m.content }))
    );
    const recentToolSummary = recentUpdates
        .map((u) => `- [${u.updateType}] ${u.message}`)
        .join('\n')
        .slice(0, 4000);
    const recentNoopCount = recentUpdates.filter(
        (u) => typeof u.message === 'string' && /\bnoop\b/i.test(u.message)
    ).length;

    const budget = computeAgentBudgetStatus({
        totalTokens: agent.totalTokens || 0,
        tickCount: tickNumber,
        limits: budgetLimitsFromAgentDoc(agent),
    });
    const budgetContext = formatAgentBudgetContext(budget);
    const forceSynthesize =
        budget.maxExceeded ||
        recentNoopCount >= 2 ||
        (budget.minsMet && budget.nearMax && memories.length > 0) ||
        (budget.minsMet && tickNumber >= budget.iterations.max);

    const skillBodies = await listEnabledSkillsForUser(agent.userId);
    const skillsCatalog = skillBodies.map((s) => ({ name: s.name, description: s.description }));
    let activeSkillNames: string[] = Array.isArray(agent.activeSkillNames)
        ? [...agent.activeSkillNames]
        : [];

    const nextStepHint = memories.find((m) => /^next_step_/i.test(m.key));
    const researchStateHint = [
        nextStepHint
            ? `MUST prefer next_step if present unless obsolete: ${nextStepHint.content.slice(0, 500)}`
            : '',
        memories.some((m) => m.key === 'research_brief')
            ? 'research_brief memory exists — use it when deciding mode=finalize.'
            : '',
    ]
        .filter(Boolean)
        .join('\n');

    const { shellWorkspaceListing, containerWorkingDir, agentFolderAbsolutePath } =
        await loadShellListing(agent);

    const logCtx: AgentLogContext = {
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
    };

    const goalExpansionDoc = await loadGoalExpansion(currentGoal._id as mongoose.Types.ObjectId);
    const goalExpansion = formatExpansionForPrompt(goalExpansionDoc);
    const expectsFile = expansionExpectsWorkspaceFile(goalExpansionDoc);
    const requiresPersonalData = goalExpansionDoc?.requiresPersonalData === true;
    const baseline = await loadOrInitWorkspaceBaseline(agent, shellWorkspaceListing);
    const workspaceDeliverables = filterNewDeliverables(
        listWorkspaceDeliverables(shellWorkspaceListing),
        baseline
    );
    const hasRepoCloneEvidence = shellWorkspaceListing.some(
        (f) => !f.isDir && /\/\.git\/HEAD$/i.test(String(f.relativePath || ''))
    ) && shellWorkspaceListing.some(
        (f) =>
            !f.isDir &&
            /(^|\/)README(\.md|\.txt)?$/i.test(
                String(f.pathInAgentFolder || f.relativePath || '').replace(/\\/g, '/')
            )
    );
    // Only real shell-listed files count — bare names in the prompt must not finalize early.
    // Git clones count when .git + README are present (README may have no extension).
    const hasFileDeliverable =
        expectsFile && (workspaceDeliverables.length > 0 || hasRepoCloneEvidence);
    const defaultAction =
        (goalExpansionDoc?.suggestedTools || [])[0] ||
        (expectsFile ? 'execute_script' : requiresPersonalData ? 'search_all_domains' : 'search_all_domains');
    const childResultsPack = await loadChildResultsPackForGoal(id, currentGoal);

    // Prefer parent_context over dumping all past goals when this is a parent rollup
    const pastGoalsForPrompt = childResultsPack
        ? goals
              .filter((g) => String(g.parentGoalId || '') === String(currentGoal._id))
              .map((g) => ({
                  title: g.title,
                  status: g.status,
                  result: (g.result || '').slice(0, 400),
              }))
        : pastGoalResults.slice(0, 8);

    let plan: AgentPlanDecision = forceSynthesize
        ? {
              kind: 'final_answer',
              mode: 'final_answer',
              reason: budget.maxExceeded
                  ? 'Budget max reached (tokens and/or iterations); synthesizing best answer'
                  : recentNoopCount >= 2
                    ? 'Too many noops; synthesizing'
                    : 'Near or at max budget with evidence; synthesizing',
              skillsToLoad: activeSkillNames,
          }
        : await planAgentStep({
              logCtx,
              llmConfig,
              toolDescriptions: defaultAgentToolRegistry.getToolDescriptions(),
              goalTitle: currentGoal.title,
              goalDescription: currentGoal.description || currentGoal.title,
              memorySummary,
              recentToolSummary: [
                  researchStateHint,
                  recentToolSummary,
                  `recentLogs: ${JSON.stringify(last50Logs.slice(-10)).slice(0, 1500)}`,
                  `pastGoals: ${JSON.stringify(pastGoalsForPrompt).slice(0, 1200)}`,
                  `shellFiles: ${shellWorkspaceListing.length}`,
                  `workspace: ${agentFolderAbsolutePath || `${containerWorkingDir}/agent/${agent.threadId}`}`,
              ]
                  .filter(Boolean)
                  .join('\n'),
              tickNumber,
              recentNoopCount,
              skillsCatalog,
              activeSkillsBlock: formatActiveSkillsBlock(
                  resolveSkillsToLoad(skillBodies, activeSkillNames)
              ),
              budgetContext,
              goalExpansion,
              childResultsPack: childResultsPack || undefined,
          });

    const prevSkillNames = [...activeSkillNames];
    const loadedSkills = resolveSkillsToLoad(skillBodies, plan.skillsToLoad);
    if (loadedSkills.length > 0) {
        activeSkillNames = Array.from(
            new Set([...activeSkillNames, ...loadedSkills.map((s) => s.name)])
        ).slice(0, 6);
        const skillsChanged =
            activeSkillNames.length !== prevSkillNames.length ||
            activeSkillNames.some((n) => !prevSkillNames.includes(n));
        if (skillsChanged) {
            await ModelAgentInstance.findByIdAndUpdate(id, {
                $set: { activeSkillNames, updatedAtUtc: new Date() },
            });
            await writeUpdate({
                agentInstanceId: id,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'skills_loaded',
                message: `Skills loaded: ${activeSkillNames.join(', ')}`,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
                payload: { skills: activeSkillNames },
            });
        }
    }

    if (
        plan.kind === 'final_answer' &&
        memories.length === 0 &&
        tickNumber <= 2 &&
        !forceSynthesize &&
        !budget.maxExceeded &&
        !hasFileDeliverable
    ) {
        plan = {
            kind: 'use_tool',
            mode: 'use_tool',
            action: defaultAction,
            query: currentGoal.description || currentGoal.title,
            reason: 'No evidence yet — follow goal expansion approach',
            scriptType: expectsFile ? 'python' : undefined,
            fileName: expectsFile ? 'create_artifact.py' : undefined,
            skillsToLoad: Array.from(
                new Set([
                    ...(plan.skillsToLoad || []),
                    ...(goalExpansionDoc?.suggestedSkills || []),
                ])
            ).slice(0, 3),
        };
    }

    // Parent rollup: once every child is completed, finalize — do not keep validating / re-running tools.
    // Exception: file deliverables still need a real workspace file (children can hallucinate success).
    const childGoals = goals.filter(
        (g) => g.parentGoalId && String(g.parentGoalId) === String(currentGoal._id)
    );
    const allChildrenCompleted =
        childGoals.length > 0 && childGoals.every((c) => c.status === 'completed');
    if (allChildrenCompleted && Boolean(childResultsPack) && !budget.maxExceeded) {
        if (expectsFile && !hasFileDeliverable) {
            plan = {
                kind: 'use_tool',
                mode: 'use_tool',
                action: 'execute_script',
                query: currentGoal.description || currentGoal.title,
                reason:
                    'Children marked done but no workspace deliverable on disk — create the file and print absolute path + size',
                scriptType: 'python',
                fileName: 'create_artifact.py',
                skillsToLoad: Array.from(
                    new Set([
                        ...activeSkillNames,
                        ...(goalExpansionDoc?.suggestedSkills || []),
                        'shell-environment',
                    ])
                ).slice(0, 3),
            };
        } else {
            plan = {
                kind: 'final_answer',
                mode: 'final_answer',
                reason: 'All child goals completed — rolling up final answer',
                skillsToLoad: activeSkillNames,
            };
        }
    }

    // Block early finalize until min token + iteration budgets are met (unless max hit).
    // Parent rollup after children is allowed even if mins are not met — work already happened on children.
    if (
        plan.kind === 'final_answer' &&
        !budget.minsMet &&
        !budget.maxExceeded &&
        !forceSynthesize &&
        !allChildrenCompleted &&
        !hasFileDeliverable
    ) {
        plan = {
            kind: 'use_tool',
            mode: 'use_tool',
            action: defaultAction,
            query: currentGoal.description || currentGoal.title,
            reason: `Min budget not met yet (tokens ${budget.tokens.used}/${budget.tokens.min}, iterations ${budget.iterations.used}/${budget.iterations.min})`,
            skillsToLoad: plan.skillsToLoad || activeSkillNames,
            scriptType: expectsFile ? 'python' : undefined,
            fileName: expectsFile ? 'create_artifact.py' : undefined,
        };
    }

    // Expansion expects a workspace file: never synthesize without artifact evidence.
    // Skip when parent is rolling up completed children (artifact work was done by children).
    if (
        plan.kind === 'final_answer' &&
        !forceSynthesize &&
        expectsFile &&
        !allChildrenCompleted &&
        !hasFileDeliverable
    ) {
        const artifactGate = applyArtifactGate({
            verify: {
                verdict: 'ready_to_synthesize',
                reason: plan.reason,
            },
            memories: memories.map((m) => ({ key: m.key, content: m.content })),
            expectsWorkspaceFile: true,
            acceptanceChecks: goalExpansionDoc?.acceptanceChecks || [],
            forceSynthesize: false,
            lastToolSummary: recentToolSummary,
            workspaceHasDeliverable: hasFileDeliverable,
        });
        if (artifactGate.verdict !== 'ready_to_synthesize') {
            plan = {
                kind: 'use_tool',
                mode: 'use_tool',
                action: artifactGate.suggestedNextAction || 'execute_script',
                query: currentGoal.description || currentGoal.title,
                reason: artifactGate.reason,
                scriptType: 'python',
                fileName: 'create_artifact.py',
                skillsToLoad: Array.from(
                    new Set([
                        ...(plan.skillsToLoad || []),
                        ...(goalExpansionDoc?.suggestedSkills || []),
                        'shell-environment',
                    ])
                ).slice(0, 3),
            };
        }
    }

    if (!forceSynthesize && plan.kind === 'use_tool' && !hasFileDeliverable) {
        const nextStepMem = memories.find((m) => /^next_step_/i.test(m.key));
        if (nextStepMem?.content) {
            try {
                const parsed = JSON.parse(nextStepMem.content) as {
                    action?: string;
                    query?: string;
                };
                if (parsed.action && typeof parsed.action === 'string') {
                    if (
                        plan.action === 'search_all_domains' ||
                        plan.action === 'noop' ||
                        !plan.query
                    ) {
                        plan = {
                            ...plan,
                            action: parsed.action,
                            query:
                                typeof parsed.query === 'string' && parsed.query.trim()
                                    ? parsed.query
                                    : plan.query,
                            reason: plan.reason
                                ? `${plan.reason} (honoring next_step)`
                                : 'Honoring next_step from verify',
                        };
                    }
                }
            } catch {
                /* ignore */
            }
        }
    }

    // File already on disk → stop verify/venv loops and finalize.
    if (hasFileDeliverable && !budget.maxExceeded) {
        const names = workspaceDeliverables
            .map((d) => `${d.pathInAgentFolder} (${d.size}b)`)
            .slice(0, 3)
            .join(', ');
        plan = {
            kind: 'final_answer',
            mode: 'final_answer',
            reason: `Deliverable present in workspace — finalize (${names})`,
            skillsToLoad: activeSkillNames,
        };
    }

    // Personal research: stop endless search once coverage / search-count is enough.
    if (
        requiresPersonalData &&
        !budget.maxExceeded &&
        plan.kind !== 'final_answer'
    ) {
        const sourcesSeen = detectSourcesSeenInMemory(
            memories.map((m) => ({ key: m.key, content: m.content }))
        );
        const searchCount = memories.filter((m) => /^search_/i.test(m.key)).length;
        const enough =
            (sourcesSeen.length >= 2 && searchCount >= 2) ||
            (sourcesSeen.length >= 1 && searchCount >= 4) ||
            (searchCount >= 6 && tickNumber >= 6) ||
            (sourcesSeen.length >= 2 && tickNumber >= 8);
        if (enough && budget.minsMet) {
            plan = {
                kind: 'final_answer',
                mode: 'final_answer',
                reason: `Personal evidence enough (${sourcesSeen.join(', ') || 'partial'}; searches=${searchCount}) — finalize`,
                skillsToLoad: activeSkillNames,
            };
        }
    }

    const brainStep: AgentBrainStep =
        plan.kind === 'final_answer'
            ? 'final_answer'
            : plan.kind === 'expand_goals'
              ? 'plan'
              : 'use_tool';

    await ModelAgentInstance.findByIdAndUpdate(id, {
        $set: { brainStep, updatedAtUtc: new Date() },
    });

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'plan',
        message:
            plan.kind === 'final_answer'
                ? `Brain: final_answer — ${plan.reason}${plan.action ? ` (check: ${plan.action})` : ''}`
                : plan.kind === 'expand_goals'
                  ? `Brain: plan (expand goals) — ${plan.reason}`
                  : `Brain: use_tool → ${plan.action}${plan.reason ? ` — ${plan.reason}` : ''}`,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
        payload: {
            plan,
            brainStep,
            activeSkillNames,
            forceSynthesize,
            tickNumber,
            budget: budgetContext,
            hasChildPack: Boolean(childResultsPack),
        },
    });

    if (plan.kind === 'final_answer') return 'final_answer';
    if (plan.kind === 'expand_goals') return 'expand_goals';
    return 'use_tool';
};

const loadLatestPlanPayload = async (
    agentRunId: mongoose.Types.ObjectId,
    tickNumber: number
): Promise<{
    plan: AgentPlanDecision;
    activeSkillNames: string[];
    forceSynthesize: boolean;
} | null> => {
    const update = await ModelAgentUpdate.findOne({
        agentInstanceId: agentRunId,
        updateType: 'plan',
        tickNumber,
    })
        .sort({ createdAtUtc: -1 })
        .lean();
    if (!update?.payload || typeof update.payload !== 'object') return null;
    const payload = update.payload as Record<string, unknown>;
    const plan = payload.plan as AgentPlanDecision | undefined;
    if (!plan || typeof plan !== 'object') return null;
    return {
        plan,
        activeSkillNames: Array.isArray(payload.activeSkillNames)
            ? (payload.activeSkillNames as string[])
            : [],
        forceSynthesize: payload.forceSynthesize === true,
    };
};

/** Execute the planned tool for this tick (reads plan from DB). */
export const agentTickRunTool = async (
    agentRunId: mongoose.Types.ObjectId | string
): Promise<void> => {
    const agent = await loadAgent(agentRunId);
    const id = agent._id as mongoose.Types.ObjectId;
    const tickNumber = agent.tickCount || 0;
    const currentGoal = await loadCurrentGoal(id);
    if (!currentGoal) {
        throw new Error('No current goal for tool');
    }

    const planned = await loadLatestPlanPayload(id, tickNumber);
    const canRunTool =
        planned &&
        (planned.plan.kind === 'use_tool' ||
            (planned.plan.kind === 'final_answer' &&
                typeof planned.plan.action === 'string' &&
                planned.plan.action.trim().length > 0));
    if (!canRunTool || !planned) {
        // Plan may already be finalize/plan without a script — skip tool quietly.
        await writeAgentLog({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            action: 'tool_skip',
            message: `No action plan for tick ${tickNumber} (kind=${planned?.plan?.kind || 'none'})`,
            level: 'info',
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
        });
        return;
    }
    const plan = planned.plan as Extract<AgentPlanDecision, { kind: 'use_tool' }> | Extract<
        AgentPlanDecision,
        { kind: 'final_answer' }
    >;
    const toolAction =
        plan.kind === 'use_tool'
            ? plan.action
            : String(plan.action || '').trim();
    if (!toolAction) {
        return;
    }

    const llmConfig = await getLlmConfig({ threadId: agent.threadId });
    if (!llmConfig) {
        throw new Error('No LLM config available for agent tick');
    }

    const memories = await ModelAgentMemory.find({ agentInstanceId: id })
        .sort({ createdAtUtc: -1 })
        .limit(25);
    const recentUpdates = await ModelAgentUpdate.find({ agentInstanceId: id })
        .sort({ createdAtUtc: -1 })
        .limit(12);

    const logCtx: AgentLogContext = {
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
    };

    const toolArgs: Record<string, unknown> = {
        action: toolAction,
        query: plan.query,
        memoryKey: plan.kind === 'use_tool' ? plan.memoryKey : undefined,
        memoryContent: plan.kind === 'use_tool' ? plan.memoryContent : undefined,
        memoryType: plan.kind === 'use_tool' ? plan.memoryType : undefined,
        message: plan.kind === 'use_tool' ? plan.message : undefined,
        code: plan.code,
        scriptType: plan.scriptType,
        fileName: plan.fileName,
        reason: plan.reason,
    };

    const tool = defaultAgentToolRegistry.getTool(toolAction);
    let toolResultSummary = '';
    let toolSuccess = true;

    if (tool) {
        const result = await tool.execute(
            {
                agentInstanceId: id,
                userId: agent.userId,
                threadId: agent.threadId,
                currentGoal,
                memories,
                recentUpdates,
                tickNumber,
                llmConfig,
                logCtx,
            },
            toolArgs
        );
        toolResultSummary = result.resultSummary || '';
        toolSuccess = result.success;
    } else {
        const fallbackTool = defaultAgentToolRegistry.getTool('noop');
        if (fallbackTool) {
            await fallbackTool.execute(
                {
                    agentInstanceId: id,
                    userId: agent.userId,
                    threadId: agent.threadId,
                    currentGoal,
                    memories,
                    recentUpdates,
                    tickNumber,
                    llmConfig,
                    logCtx,
                },
                { reason: `Unrecognized action: ${toolAction}` }
            );
        }
        toolResultSummary = `Unrecognized action: ${toolAction}`;
        toolSuccess = false;
    }

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'tool_result',
        message: `Tool ${toolAction}: ${toolSuccess ? 'ok' : 'fail'} — ${toolResultSummary.slice(0, 200)}`,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
        payload: {
            action: toolAction,
            toolResultSummary: toolResultSummary.slice(0, 4000),
            toolSuccess,
            forceSynthesize: planned.forceSynthesize,
            activeSkillNames: planned.activeSkillNames,
        },
    });
};

/**
 * Verify latest tool result (reads tool_result + plan from DB).
 * Returns whether synthesize should run next.
 */
export const agentTickVerify = async (
    agentRunId: mongoose.Types.ObjectId | string
): Promise<'continue' | 'ready_to_synthesize' | 'retry'> => {
    const agent = await loadAgent(agentRunId);
    const id = agent._id as mongoose.Types.ObjectId;
    const tickNumber = agent.tickCount || 0;
    const currentGoal = await loadCurrentGoal(id);
    if (!currentGoal) {
        throw new Error('No current goal for verify');
    }

    const toolUpdate =
        (await ModelAgentUpdate.findOne({
            agentInstanceId: id,
            updateType: 'tool_result',
            tickNumber,
        })
            .sort({ createdAtUtc: -1 })
            .lean()) ||
        (await ModelAgentUpdate.findOne({
            agentInstanceId: id,
            updateType: 'tool_result',
        })
            .sort({ createdAtUtc: -1 })
            .lean());
    const toolPayload = (toolUpdate?.payload || {}) as Record<string, unknown>;
    const lastAction =
        typeof toolPayload.action === 'string'
            ? toolPayload.action
            : agent.brainStep === 'final_answer' || agent.brainStep === 'observe'
              ? 'observe'
              : 'unknown';
    const toolResultSummary =
        typeof toolPayload.toolResultSummary === 'string'
            ? toolPayload.toolResultSummary
            : agent.brainStep === 'final_answer' || agent.brainStep === 'observe'
              ? 'Observe/final_answer: judge from memory and goal expansion (optional check script may have run).'
              : '';
    const toolSuccess = toolPayload.toolSuccess !== false;
    const forceSynthesize = toolPayload.forceSynthesize === true;
    let activeSkillNames = Array.isArray(toolPayload.activeSkillNames)
        ? (toolPayload.activeSkillNames as string[])
        : Array.isArray(agent.activeSkillNames)
          ? [...agent.activeSkillNames]
          : [];

    const llmConfig = await getLlmConfig({ threadId: agent.threadId });
    if (!llmConfig) {
        throw new Error('No LLM config available for agent tick');
    }

    const skillBodies = await listEnabledSkillsForUser(agent.userId);
    const activeSkillsBlock = formatActiveSkillsBlock(
        resolveSkillsToLoad(skillBodies, activeSkillNames)
    );

    const freshForVerify = await ModelAgentMemory.find({ agentInstanceId: id })
        .sort({ createdAtUtc: -1 })
        .limit(25);
    const verifyMemMapped = freshForVerify.map((m) => ({
        key: m.key,
        memoryType: m.memoryType,
        content: m.content,
    }));

    const logCtx: AgentLogContext = {
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
    };

    const budgetContext = formatAgentBudgetContext(
        computeAgentBudgetStatus({
            totalTokens: agent.totalTokens || 0,
            tickCount: tickNumber,
            limits: budgetLimitsFromAgentDoc(agent),
        })
    );

    const goalExpansionDoc = await loadGoalExpansion(currentGoal._id as mongoose.Types.ObjectId);
    const goalExpansion = formatExpansionForPrompt(goalExpansionDoc);

    let verify = await verifyAgentStep({
        logCtx,
        llmConfig,
        goalTitle: currentGoal.title,
        goalDescription: currentGoal.description || currentGoal.title,
        lastAction,
        lastResultSummary: toolResultSummary,
        memorySummary: formatMemorySummary(verifyMemMapped),
        activeSkillsBlock,
        budgetContext,
        goalExpansion,
    });

    verify = applyEvidenceGate({
        verify,
        memories: verifyMemMapped,
        requiresPersonalData: goalExpansionDoc?.requiresPersonalData === true,
        forceSynthesize,
        tickNumber,
    });

    let deliverableReady = false;
    let diskDeliverables: ReturnType<typeof listWorkspaceDeliverables> = [];
    if (expansionExpectsWorkspaceFile(goalExpansionDoc)) {
        const { shellWorkspaceListing } = await loadShellListing(agent);
        const baseline = await loadOrInitWorkspaceBaseline(agent, shellWorkspaceListing);
        diskDeliverables = filterNewDeliverables(
            listWorkspaceDeliverables(shellWorkspaceListing),
            baseline
        );
        const hasRepoCloneEvidence =
            shellWorkspaceListing.some(
                (f) => !f.isDir && /\/\.git\/HEAD$/i.test(String(f.relativePath || ''))
            ) &&
            shellWorkspaceListing.some(
                (f) =>
                    !f.isDir &&
                    /(^|\/)README(\.md|\.txt)?$/i.test(
                        String(f.pathInAgentFolder || f.relativePath || '').replace(/\\/g, '/')
                    )
            );
        deliverableReady = diskDeliverables.length > 0 || hasRepoCloneEvidence;
    }

    verify = applyArtifactGate({
        verify,
        memories: verifyMemMapped,
        expectsWorkspaceFile: expansionExpectsWorkspaceFile(goalExpansionDoc),
        acceptanceChecks: goalExpansionDoc?.acceptanceChecks || [],
        forceSynthesize,
        lastToolSummary: toolResultSummary,
        workspaceHasDeliverable: deliverableReady,
    });

    // If the deliverable already exists on disk, do not keep looping on verification scripts.
    if (!forceSynthesize && deliverableReady) {
        const names = diskDeliverables
            .map((d) => `${d.pathInAgentFolder} (${d.size}b)`)
            .slice(0, 3)
            .join(', ');
        verify = {
            ...verify,
            verdict: 'ready_to_synthesize',
            reason: `Deliverable present — finalize (${names})`.slice(0, 200),
            evidenceGaps: [],
            suggestedNextAction: undefined,
            retryHint: undefined,
        };
    }

    const budgetStatus = computeAgentBudgetStatus({
        totalTokens: agent.totalTokens || 0,
        tickCount: tickNumber,
        limits: budgetLimitsFromAgentDoc(agent),
    });
    if (
        verify.verdict === 'ready_to_synthesize' &&
        !budgetStatus.minsMet &&
        !budgetStatus.maxExceeded &&
        !forceSynthesize &&
        !deliverableReady
    ) {
        verify = {
            ...verify,
            verdict: 'continue',
            reason: `Min budget not met (tokens ${budgetStatus.tokens.used}/${budgetStatus.tokens.min}, iterations ${budgetStatus.iterations.used}/${budgetStatus.iterations.min})`,
        };
    }
    if (budgetStatus.maxExceeded || forceSynthesize) {
        verify = {
            ...verify,
            verdict: 'ready_to_synthesize',
            reason: budgetStatus.maxExceeded
                ? 'Budget max reached; synthesizing'
                : verify.reason || 'Forced synthesize',
        };
    }

    if (verify.researchBrief && verify.researchBrief.trim()) {
        await ModelAgentMemory.create({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            key: 'research_brief',
            content: verify.researchBrief.slice(0, 8000),
            memoryType: 'result',
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });
    }

    if (
        (verify.verdict === 'continue' || verify.verdict === 'retry') &&
        verify.suggestedNextAction
    ) {
        await ModelAgentMemory.create({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            key: `next_step_${tickNumber}`,
            content: JSON.stringify({
                action: verify.suggestedNextAction,
                query:
                    verify.suggestedQuery ||
                    currentGoal.title ||
                    currentGoal.description ||
                    '',
                gaps: verify.evidenceGaps || [],
                sourcesSeen: verify.sourcesSeen || [],
            }).slice(0, 4000),
            memoryType: 'plan',
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });
    }

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'verify',
        message: `Verify: ${verify.verdict}${verify.reason ? ` — ${verify.reason}` : ''}`,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
        payload: { ...verify, toolSuccess, forceSynthesize },
    });

    if (verify.verdict === 'retry' && verify.retryHint) {
        await ModelAgentMemory.create({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            key: `retry_hint_${tickNumber}`,
            content: verify.retryHint,
            memoryType: 'plan',
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });
    }

    if (
        verify.verdict === 'continue' &&
        goalExpansionDoc?.requiresPersonalData === true &&
        !activeSkillNames.includes('personal-research')
    ) {
        const withResearch = resolveSkillsToLoad(skillBodies, [
            ...activeSkillNames,
            'personal-research',
            ...(goalExpansionDoc.suggestedSkills || []),
        ]);
        if (withResearch.some((s) => s.name === 'personal-research')) {
            activeSkillNames = Array.from(
                new Set([...activeSkillNames, 'personal-research'])
            ).slice(0, 6);
            await ModelAgentInstance.findByIdAndUpdate(id, {
                $set: { activeSkillNames, updatedAtUtc: new Date() },
            });
        }
    }

    if (verify.verdict === 'ready_to_synthesize' || (forceSynthesize && freshForVerify.length > 0)) {
        return 'ready_to_synthesize';
    }
    return verify.verdict;
};

/** Synthesize final answer for current goal (loads everything from agent run id). */
export const agentTickSynthesize = async (
    agentRunId: mongoose.Types.ObjectId | string,
    reason?: string
): Promise<void> => {
    const agent = await loadAgent(agentRunId);
    const id = agent._id as mongoose.Types.ObjectId;
    const tickNumber = agent.tickCount || 0;
    const currentGoal = await loadCurrentGoal(id);
    if (!currentGoal) {
        throw new Error('No current goal for synthesize');
    }

    const isChildGoal = Boolean(currentGoal.parentGoalId);

    const llmConfig = await getLlmConfig({ threadId: agent.threadId });
    if (!llmConfig) {
        throw new Error('No LLM config available for agent tick');
    }

    const skillBodies = await listEnabledSkillsForUser(agent.userId);
    const activeSkillNames = Array.isArray(agent.activeSkillNames) ? [...agent.activeSkillNames] : [];
    const activeSkillsBlock = formatActiveSkillsBlock(
        resolveSkillsToLoad(skillBodies, activeSkillNames)
    );

    const recentChatDocs = await ModelChatLlm.find({ threadId: agent.threadId })
        .sort({ createdAtUtc: -1 })
        .limit(10);
    const past10Messages = recentChatDocs.reverse().map((m) => ({
        role: m.isAi ? 'assistant' : 'user',
        content: m.content.slice(0, 1000),
    }));

    const freshMemories = await ModelAgentMemory.find({ agentInstanceId: id })
        .sort({ createdAtUtc: -1 })
        .limit(40);
    const memMapped = freshMemories.map((m) => ({
        key: m.key,
        memoryType: m.memoryType,
        content: m.content,
    }));
    const citations = collectCitationsFromMemories(memMapped);
    const sourcesSeen = detectSourcesSeenInMemory(memMapped);
    const briefMem = freshMemories.find((m) => m.key === 'research_brief');
    const confidence: 'low' | 'medium' | 'high' =
        sourcesSeen.length >= 3 || (briefMem && sourcesSeen.length >= 2)
            ? 'high'
            : sourcesSeen.length >= 1 || Boolean(briefMem)
              ? 'medium'
              : 'low';

    const logCtx: AgentLogContext = {
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
    };

    const budgetContext = formatAgentBudgetContext(
        computeAgentBudgetStatus({
            totalTokens: agent.totalTokens || 0,
            tickCount: tickNumber,
            limits: budgetLimitsFromAgentDoc(agent),
        })
    );

    // Only stream a chat row for the last open goal of the run (never for child goals).
    // Final agent_success tagging + dedupe happens in ensureAgentTerminalChatMessage on exit —
    // that prevents duplicate "success" bubbles (synthesize + terminal ensure).
    const allGoals = await ModelAgentGoal.find({ agentInstanceId: id }).select('_id status').lean();
    const otherOpenGoals = allGoals.filter(
        (g) =>
            String(g._id) !== String(currentGoal._id) &&
            (g.status === 'pending' || g.status === 'in_progress')
    );
    const shouldPostChat = !isChildGoal && otherOpenGoals.length === 0;

    let placeholderId: mongoose.Types.ObjectId | null = null;
    if (shouldPostChat) {
        const placeholder = await ModelChatLlm.create({
            type: 'text',
            content: 'AI generating in progress…',
            userId: agent.userId,
            threadId: agent.threadId,
            isAi: true,
            tags: ['agent', 'finalize', 'streaming', agentRunTag(id)],
            aiModelProvider: llmConfig.provider || '',
            aiModelName: llmConfig.model || '',
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });
        placeholderId = placeholder._id as mongoose.Types.ObjectId;

        await writeUpdate({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'synthesize',
            message: 'Writing answer…',
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
            payload: { streaming: true, chatMessageId: String(placeholderId) },
        });
    } else {
        await writeUpdate({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'synthesize',
            message: isChildGoal
                ? `Writing sub-goal result (no chat post): ${currentGoal.title}`
                : `Writing goal result (deferred chat until run ends): ${currentGoal.title}`,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
            payload: { streaming: false, childGoal: isChildGoal, deferredChat: !shouldPostChat },
        });
    }

    const goalExpansionDoc = await loadGoalExpansion(currentGoal._id as mongoose.Types.ObjectId);
    const goalExpansion = formatExpansionForPrompt(goalExpansionDoc);
    const childResultsPack = await loadChildResultsPackForGoal(id, currentGoal);

    let answer = '';
    try {
        answer = await synthesizeAgentAnswer({
            logCtx,
            llmConfig,
            goalTitle: currentGoal.title,
            goalDescription: currentGoal.description || currentGoal.title,
            memorySummary: formatMemorySummary(memMapped),
            pastChatSummary: past10Messages
                .map((m) => `${m.role}: ${m.content}`)
                .join('\n')
                .slice(0, 3000),
            activeSkillsBlock,
            chatMessageId: placeholderId || undefined,
            budgetContext,
            goalExpansion,
            childResultsPack: childResultsPack || undefined,
        });
    } catch (synthErr) {
        if (placeholderId) {
            try {
                await ModelChatLlm.findByIdAndDelete(placeholderId);
            } catch (e) {
                console.error('Failed to delete failed synthesize placeholder:', e);
            }
        }
        throw synthErr;
    }

    currentGoal.status = 'completed';
    currentGoal.result = answer.slice(0, 8000);
    currentGoal.completedAtUtc = new Date();
    currentGoal.updatedAtUtc = new Date();
    await currentGoal.save();
    await writeChildResultIntoParentContext({
        agentRunId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        completedGoal: currentGoal,
    });

    await ModelAgentMemory.create({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        key: `goal_${String(currentGoal._id)}_result`,
        content: currentGoal.result,
        memoryType: 'result',
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'synthesize',
        message: isChildGoal
            ? `Synthesized sub-goal result for: ${currentGoal.title}`
            : `Synthesized final answer for: ${currentGoal.title}`,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
        payload: {
            answerLength: answer.length,
            citationsCount: citations.length,
            outputFormat: goalExpansionDoc?.outputFormat || '',
            childGoal: isChildGoal,
        },
    });

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'goal_completed',
        message: `Completed goal: ${currentGoal.title}`,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
        payload: { result: currentGoal.result },
    });

    if (placeholderId) {
        // Do not tag agent_success here — finishIfDone → ensureAgentTerminalChatMessage
        // owns the single terminal success/fail message and dedupes any extras.
        await ModelChatLlm.findByIdAndUpdate(placeholderId, {
            $set: {
                content: answer.slice(0, 12000),
                tags: ['agent', 'finalize', agentRunTag(id)],
                aiModelProvider: llmConfig.provider || '',
                aiModelName: llmConfig.model || '',
                updatedAtUtc: new Date(),
            },
            $unset: { agentFinalArtifactV1: 1 },
        });

        await persistAgentFinalWithCitations({
            chatMessageId: placeholderId,
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            researchBrief: briefMem?.content || '',
            confidence,
            citations,
        });
    }

    await writeAgentLog({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        action: 'synthesize',
        message: reason || (isChildGoal ? 'Synthesized sub-goal result' : 'Synthesized final answer'),
        tickNumber,
        payload: {
            answerLength: answer.length,
            citationsCount: citations.length,
            confidence,
            childGoal: isChildGoal,
        },
    });
};

/** Release the running lock after a successful tick (keeps status pending if more work). */
export const agentTickRelease = async (
    agentRunId: mongoose.Types.ObjectId | string
): Promise<void> => {
    const id = toId(agentRunId);
    await ModelAgentInstance.findByIdAndUpdate(id, {
        $set: {
            statusIsRunning: false,
            lastTickAtUtc: new Date(),
            updatedAtUtc: new Date(),
        },
    });
};

/** Mark run failed and ensure a terminal chat message. */
export const agentTickFail = async (
    agentRunId: mongoose.Types.ObjectId | string,
    err: unknown
): Promise<void> => {
    const agent = await ModelAgentInstance.findById(toId(agentRunId));
    if (!agent) return;

    const id = agent._id as mongoose.Types.ObjectId;
    const errMsg = err instanceof Error ? err.message : String(err);

    await ModelAgentInstance.findByIdAndUpdate(id, {
        $set: {
            status: 'failed',
            brainStep: 'done',
            statusIsRunning: false,
            errorReason: errMsg.slice(0, 1000),
            updatedAtUtc: new Date(),
        },
    });
    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'error',
        message: `Agent tick error: ${errMsg}`,
        tickNumber: agent.tickCount || 0,
    });
    await writeAgentLog({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        action: 'agent_error',
        message: errMsg,
        level: 'error',
        tickNumber: agent.tickCount || 0,
    });
    try {
        await ensureAgentTerminalChatMessage({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            outcome: 'failed',
            reason: errMsg,
        });
    } catch (ensureErr) {
        console.error('ensureAgentTerminalChatMessage failed:', ensureErr);
    }
};
