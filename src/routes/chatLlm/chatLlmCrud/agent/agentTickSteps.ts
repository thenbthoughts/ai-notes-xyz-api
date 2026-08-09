import mongoose from 'mongoose';
import axios from 'axios';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { IAgentGoal } from '../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentGoal.types';
import { IAgentInstance } from '../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentInstance.types';
import { ModelAgentMemory } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentUpdate } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelAgentLog } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentLog.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import { getLlmConfig } from '../chatLlmGetLlmConfig';
import { agentTaskFilesDir, getAgentShellConfig } from './agentShellWorkspace';
import syncThreadUploadsToAgentWorkspace from './agentSyncUploads';
import writeAgentLog, { type AgentLogContext } from './agentWriteLog';
import { defaultAgentToolRegistry, writeUpdate } from './agentToolRegistry';
import {
    applyEvidenceGate,
    detectSourcesSeenInMemory,
    formatMemorySummary,
    isPersonalResearchGoal,
    planAgentStep,
    synthesizeAgentAnswer,
    verifyAgentStep,
    type AgentPlanDecision,
} from './agentPlanVerify';
import {
    formatActiveSkillsBlock,
    listEnabledSkillsForUser,
    resolveSkillsToLoad,
} from './agentSkillsLib';
import { persistAgentFinalWithCitations } from './agentFinalPersist';
import {
    agentRunTag,
    ensureAgentTerminalChatMessage,
} from './ensureAgentTerminalChatMessage';
import {
    budgetLimitsFromAgentDoc,
    computeAgentBudgetStatus,
    formatAgentBudgetContext,
} from './agentBudget';

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
    });
    return goals.find((g) => g.status === 'in_progress' || g.status === 'pending') || null;
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
 */
export const agentTickClaim = async (
    agentRunId: mongoose.Types.ObjectId | string
): Promise<boolean> => {
    const now = new Date();
    const agent = await ModelAgentInstance.findOneAndUpdate(
        {
            _id: toId(agentRunId),
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

        if (isPersonalResearchGoal(currentGoal.title, currentGoal.description || currentGoal.title)) {
            const skillBodiesEarly = await listEnabledSkillsForUser(agent.userId);
            const withResearch = resolveSkillsToLoad(skillBodiesEarly, [
                ...(Array.isArray(agent.activeSkillNames) ? agent.activeSkillNames : []),
                'personal-research',
            ]);
            if (withResearch.some((s) => s.name === 'personal-research')) {
                const nextNames = Array.from(
                    new Set([
                        ...(Array.isArray(agent.activeSkillNames) ? agent.activeSkillNames : []),
                        'personal-research',
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
                    payload: { skills: nextNames, auto: true },
                });
            }
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
                                if (/\b(node_modules|\.git)\b/i.test(rel) || /package-lock\.json$/i.test(rel)) {
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
 * Plan the next action for this tick. Persists decision on a `plan` update (handoff via DB).
 * Returns 'synthesize' | 'action'.
 */
export const agentTickPlan = async (
    agentRunId: mongoose.Types.ObjectId | string
): Promise<'synthesize' | 'action'> => {
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
            ? 'research_brief memory exists — use it when deciding readyToSynthesize.'
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

    let plan: AgentPlanDecision = forceSynthesize
        ? {
              kind: 'synthesize',
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
                  `recentLogs: ${JSON.stringify(last50Logs.slice(-15)).slice(0, 2000)}`,
                  `pastGoals: ${JSON.stringify(pastGoalResults).slice(0, 1500)}`,
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
        plan.kind === 'synthesize' &&
        memories.length === 0 &&
        tickNumber <= 2 &&
        !forceSynthesize &&
        !budget.maxExceeded
    ) {
        plan = {
            kind: 'action',
            action: 'search_all_domains',
            query: currentGoal.description || currentGoal.title,
            reason: 'No evidence yet — search personal domains first',
            skillsToLoad: Array.from(
                new Set([...(plan.skillsToLoad || []), 'personal-research'])
            ).slice(0, 3),
        };
    }

    // Block early synthesize until min token + iteration budgets are met (unless max hit).
    if (plan.kind === 'synthesize' && !budget.minsMet && !budget.maxExceeded && !forceSynthesize) {
        plan = {
            kind: 'action',
            action: 'search_all_domains',
            query: currentGoal.description || currentGoal.title,
            reason: `Min budget not met yet (tokens ${budget.tokens.used}/${budget.tokens.min}, iterations ${budget.iterations.used}/${budget.iterations.min})`,
            skillsToLoad: plan.skillsToLoad || activeSkillNames,
        };
    }

    if (!forceSynthesize && plan.kind === 'action') {
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

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'plan',
        message:
            plan.kind === 'synthesize'
                ? `Plan: synthesize — ${plan.reason}`
                : `Plan: ${plan.action}${plan.reason ? ` — ${plan.reason}` : ''}`,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
        payload: { plan, activeSkillNames, forceSynthesize, tickNumber, budget: budgetContext },
    });

    return plan.kind === 'synthesize' ? 'synthesize' : 'action';
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
    if (!planned || planned.plan.kind !== 'action') {
        throw new Error('No action plan found for this tick');
    }
    const plan = planned.plan;

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
        action: plan.action,
        query: plan.query,
        memoryKey: plan.memoryKey,
        memoryContent: plan.memoryContent,
        memoryType: plan.memoryType,
        message: plan.message,
        code: plan.code,
        scriptType: plan.scriptType,
        fileName: plan.fileName,
        reason: plan.reason,
    };

    const tool = defaultAgentToolRegistry.getTool(plan.action);
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
                { reason: `Unrecognized action: ${plan.action}` }
            );
        }
        toolResultSummary = `Unrecognized action: ${plan.action}`;
        toolSuccess = false;
    }

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'tool_result',
        message: `Tool ${plan.action}: ${toolSuccess ? 'ok' : 'fail'} — ${toolResultSummary.slice(0, 200)}`,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
        payload: {
            action: plan.action,
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

    const toolUpdate = await ModelAgentUpdate.findOne({
        agentInstanceId: id,
        updateType: 'tool_result',
        tickNumber,
    })
        .sort({ createdAtUtc: -1 })
        .lean();
    const toolPayload = (toolUpdate?.payload || {}) as Record<string, unknown>;
    const lastAction = typeof toolPayload.action === 'string' ? toolPayload.action : 'unknown';
    const toolResultSummary =
        typeof toolPayload.toolResultSummary === 'string' ? toolPayload.toolResultSummary : '';
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
    });

    verify = applyEvidenceGate({
        verify,
        memories: verifyMemMapped,
        goalTitle: currentGoal.title,
        goalDescription: currentGoal.description || currentGoal.title,
        forceSynthesize,
        activeSkillNames,
    });

    const budgetStatus = computeAgentBudgetStatus({
        totalTokens: agent.totalTokens || 0,
        tickCount: tickNumber,
        limits: budgetLimitsFromAgentDoc(agent),
    });
    if (
        verify.verdict === 'ready_to_synthesize' &&
        !budgetStatus.minsMet &&
        !budgetStatus.maxExceeded &&
        !forceSynthesize
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
        isPersonalResearchGoal(currentGoal.title, currentGoal.description || currentGoal.title) &&
        !activeSkillNames.includes('personal-research')
    ) {
        const withResearch = resolveSkillsToLoad(skillBodies, [
            ...activeSkillNames,
            'personal-research',
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

    const placeholder = await ModelChatLlm.create({
        type: 'text',
        content: 'AI generating in progress…',
        userId: agent.userId.toString(),
        threadId: agent.threadId,
        isAi: true,
        tags: ['agent', 'final_answer', 'streaming', agentRunTag(id)],
        aiModelProvider: llmConfig.provider || '',
        aiModelName: llmConfig.model || '',
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'synthesize',
        message: 'Writing answer…',
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
        payload: { streaming: true, chatMessageId: String(placeholder._id) },
    });

    const answer = await synthesizeAgentAnswer({
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
        chatMessageId: placeholder._id as mongoose.Types.ObjectId,
        budgetContext,
    });

    currentGoal.status = 'completed';
    currentGoal.result = answer.slice(0, 8000);
    currentGoal.completedAtUtc = new Date();
    currentGoal.updatedAtUtc = new Date();
    await currentGoal.save();

    await ModelAgentMemory.create({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        key: `goal_${currentGoal.orderIndex}_result`,
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
        message: `Synthesized final answer for: ${currentGoal.title}`,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
        payload: { answerLength: answer.length, citationsCount: citations.length },
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

    await ModelChatLlm.findByIdAndUpdate(placeholder._id, {
        $set: {
            content: answer.slice(0, 12000),
            tags: ['agent', 'final_answer', 'agent_success', agentRunTag(id)],
            aiModelProvider: llmConfig.provider || '',
            aiModelName: llmConfig.model || '',
            updatedAtUtc: new Date(),
        },
        $unset: { agentFinalArtifactV1: 1 },
    });

    await persistAgentFinalWithCitations({
        chatMessageId: placeholder._id as mongoose.Types.ObjectId,
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        researchBrief: briefMem?.content || '',
        confidence,
        citations,
    });

    await writeAgentLog({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        action: 'synthesize',
        message: reason || 'Synthesized final answer',
        tickNumber,
        payload: {
            answerLength: answer.length,
            citationsCount: citations.length,
            confidence,
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
