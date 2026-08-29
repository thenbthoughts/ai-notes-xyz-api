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
import { ModelUserApiKey } from '../../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../../utils/llm/llmCommonFunc';
import { getLlmConfig } from '../../chatUtils/chatLlmGetLlmConfig';
import { agentTaskFilesDir, getAgentShellConfig } from '../agentUtils/agentShell/agentShellWorkspace';
import {
    AGENT_WORKSPACE_CONTAINER_STORAGE,
    AGENT_WORKSPACE_SHELL_PREFIX,
} from '../../../../../utils/agentWorkspace/agentWorkspacePaths';
import {
    AGENT_SHELL_CONTEXT_FILE_LIMIT,
    normalizeAgentShellListing,
    type AgentShellListEntry,
} from '../agentUtils/agentShell/agentShellListing';
import syncThreadUploadsToAgentWorkspace from '../agentUtils/agentSyncUploads';
import writeAgentLog, { type AgentLogContext } from '../agentUtils/agentWriteLog';
import { buildAgentContextPack } from '../agentUtils/agentContextWindow';
import { defaultAgentToolRegistry, writeUpdate } from './agentToolRegistry';
import {
    applyArtifactGate,
    applyEvidenceGate,
    detectSourcesSeenInMemory,
    formatMemorySummary,
    listWorkspaceDeliverables,
    filterNewDeliverables,
    fileSizeChangedFromBaseline,
    namedOutputFilesInGoalText,
    namedOutputsEmptyOnDisk,
    inferExpectedDeliverableExts,
    goalRequiresCodeDeliverable,
    goalRequiresDatabaseDeliverable,
    hasDatabaseDeliverableEvidence,
    toolEvidenceSupportsDeliverables,
    toolTouchedWorkspaceFile,
    mergeStdoutDeliverables,
    looksLikeUnexecutedToolPlan,
    looksLikeIncompleteProgress,
    isChatOrTextGoal,
    toolOutputLooksLikeChatAnswer,
    planAgentStep,
    synthesizeAgentAnswer,
    verifyAgentStep,
    type AgentPlanDecision,
    type AgentVerifyVerdict,
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

const namedFilesFromGoalContext = (params: {
    title?: string;
    description?: string;
    outputFormat?: string;
    suggestedApproach?: string;
    expectations?: string[];
    acceptanceChecks?: string[];
}): string[] =>
    namedOutputFilesInGoalText(
        [
            params.title || '',
            params.description || '',
            params.outputFormat || '',
            params.suggestedApproach || '',
            ...(params.expectations || []),
            ...(params.acceptanceChecks || []),
        ].join('\n')
    );

/** Full execute_script stdout from update payloads — not the 200-char log line. */
const toolStdoutFromUpdates = (
    updates: Array<{ updateType?: string; message?: string; payload?: unknown }>
): string =>
    updates
        .filter(
            (u) =>
                u.updateType === 'tool_result' ||
                u.updateType === 'script_executed' ||
                u.updateType === 'error'
        )
        .map((u) => {
            const p = (u.payload || {}) as Record<string, unknown>;
            const full = typeof p.toolResultSummary === 'string' ? p.toolResultSummary : '';
            return full.trim() || String(u.message || '');
        })
        .filter(Boolean)
        .join('\n')
        .slice(0, 8000);

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
    // Update progress file for multi-message threads
    try {
        const { writeProgressFile } = await import('../agentUtils/agentProgress/agentProgressFile');
        await writeProgressFile({
            threadId: agent.threadId,
            agentInstanceId: id,
            userId: agent.userId,
            logCtx: { agentInstanceId: id, userId: agent.userId, threadId: agent.threadId, tickNumber: agent.tickCount || 0 },
        });
    } catch (e) {
        console.error('writeProgressFile on finish failed:', e);
    }
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
        // Generic multi-message and GUI inference (not hardcoded per question)
        let extraGenericSkills: string[] = [];
        try {
            const msgCount = await ModelChatLlm.countDocuments({ threadId: agent.threadId });
            if (msgCount > 3) extraGenericSkills.push('progress-tracking');
            const blob = `${currentGoal.title}\n${currentGoal.description || ''}\n${expansion?.suggestedApproach || ''}`.toLowerCase();
            if (/\b(browser|screenshot|zip|archive|desktop|chrome|soffice)\b/.test(blob)) extraGenericSkills.push('gui-desktop');
            if (/\b(large|split|chunk|divide file)\b/.test(blob)) extraGenericSkills.push('shell-environment');
        } catch {}
        const wantedFromExpansion = [
            ...(Array.isArray(agent.activeSkillNames) ? agent.activeSkillNames : []),
            ...(expansion?.suggestedSkills || []),
            ...(expansion?.requiresShell ? ['shell-environment'] : []),
            ...(expansion?.requiresPersonalData ? ['personal-research'] : []),
            ...extraGenericSkills,
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

type WorkspaceBaseline = { paths: Set<string>; sizesByName: Map<string, number> };

const sizesMapFromRecord = (sizes: Record<string, number>): Map<string, number> => {
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(sizes || {})) {
        const name = String(k || '')
            .replace(/\\/g, '/')
            .toLowerCase()
            .split('/')
            .pop();
        if (name && typeof v === 'number') m.set(name, v);
    }
    return m;
};

const parseBaselineContent = (
    content: string
): { paths: string[]; sizes: Record<string, number> } => {
    try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            return { paths: parsed.map((p) => String(p)), sizes: {} };
        }
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { paths?: unknown }).paths)) {
            const sizesRaw = (parsed as { sizes?: unknown }).sizes;
            const sizes =
                sizesRaw && typeof sizesRaw === 'object' && !Array.isArray(sizesRaw)
                    ? (sizesRaw as Record<string, number>)
                    : {};
            return {
                paths: ((parsed as { paths: unknown[] }).paths || []).map((p) => String(p)),
                sizes,
            };
        }
    } catch {
        /* ignore */
    }
    return { paths: [], sizes: {} };
};

const loadOrInitWorkspaceBaseline = async (
    agent: IAgentInstance,
    listing: Array<{ relativePath: string; pathInAgentFolder?: string; isDir?: boolean; size?: number }>
): Promise<WorkspaceBaseline> => {
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
    const listingSizes: Record<string, number> = {};
    for (const f of listing || []) {
        if (!f || f.isDir || !(f.size || 0)) continue;
        const short = String(f.pathInAgentFolder || f.relativePath || '')
            .replace(/\\/g, '/')
            .split('/')
            .pop();
        if (short) listingSizes[short.toLowerCase()] = f.size || 0;
    }

    if (existing?.content) {
        const parsed = parseBaselineContent(existing.content);
        const base = new Set(parsed.paths.map((p) => String(p).replace(/\\/g, '/').toLowerCase()));
        // Empty baseline locked before fixture uploads synced — refresh with uploads/ only.
        // Never absorb agent-created outputs into the baseline (that hides deliverables) for first-turn fixture sync.
        // For multi-conversation follow-ups, empty baseline with existing non-upload files means prior deliverables exist — treat them as baseline.
        if (base.size === 0 && listingPaths.length > 0) {
            const uploadOnly = listingPaths.filter((p) => /(^|\/)uploads\//i.test(p));
            if (uploadOnly.length === 0) {
                // Follow-up conversation: prior workspace files exist, set baseline to full listing so new deliverables are correctly detected
                const nowFollowUp = new Date();
                await ModelAgentMemory.findOneAndUpdate(
                    { agentInstanceId: id, key: 'workspace_baseline_files' },
                    {
                        $set: {
                            userId: agent.userId,
                            threadId: agent.threadId,
                            content: JSON.stringify({ paths: listingPaths, sizes: listingSizes }).slice(0, 12000),
                            memoryType: 'fact',
                            updatedAtUtc: nowFollowUp,
                        },
                        $setOnInsert: { createdAtUtc: nowFollowUp },
                    },
                    { upsert: true }
                );
                return {
                    paths: new Set(listingPaths.map((p) => p.toLowerCase())),
                    sizesByName: sizesMapFromRecord(listingSizes),
                };
            }
            const now = new Date();
            const uploadSizes: Record<string, number> = {};
            for (const p of uploadOnly) {
                const name = p.replace(/\\/g, '/').split('/').pop() || '';
                if (name && listingSizes[name.toLowerCase()] != null) {
                    uploadSizes[name.toLowerCase()] = listingSizes[name.toLowerCase()];
                }
            }
            await ModelAgentMemory.findOneAndUpdate(
                { agentInstanceId: id, key: 'workspace_baseline_files' },
                {
                    $set: {
                        userId: agent.userId,
                        threadId: agent.threadId,
                        content: JSON.stringify({ paths: uploadOnly, sizes: uploadSizes }).slice(0, 12000),
                        memoryType: 'fact',
                        updatedAtUtc: now,
                    },
                    $setOnInsert: { createdAtUtc: now },
                },
                { upsert: true }
            );
            return {
                paths: new Set(uploadOnly.map((p) => p.toLowerCase())),
                sizesByName: sizesMapFromRecord(uploadSizes),
            };
        }
        return { paths: base, sizesByName: sizesMapFromRecord(parsed.sizes) };
    }

    const now = new Date();
    await ModelAgentMemory.findOneAndUpdate(
        { agentInstanceId: id, key: 'workspace_baseline_files' },
        {
            $set: {
                userId: agent.userId,
                threadId: agent.threadId,
                content: JSON.stringify({ paths: listingPaths, sizes: listingSizes }).slice(0, 12000),
                memoryType: 'fact',
                updatedAtUtc: now,
            },
            $setOnInsert: { createdAtUtc: now },
        },
        { upsert: true }
    );
    return {
        paths: new Set(listingPaths.map((p) => p.toLowerCase())),
        sizesByName: sizesMapFromRecord(listingSizes),
    };
};

const loadShellListing = async (agent: IAgentInstance) => {
    const agentShellDir = agentTaskFilesDir(String(agent.threadId));
    let shellWorkspaceListing: AgentShellListEntry[] = [];
    let containerWorkingDir = `${AGENT_WORKSPACE_CONTAINER_STORAGE}/${AGENT_WORKSPACE_SHELL_PREFIX}`;
    let agentFolderAbsolutePath = `${AGENT_WORKSPACE_CONTAINER_STORAGE}/${agentShellDir}`;

    try {
        const apiKeyDoc = await ModelUserApiKey.findOne({ userId: agent.userId });
        if (apiKeyDoc) {
            const apiKey = getApiKeyByObject(apiKeyDoc);
            const shell = getAgentShellConfig(apiKey);
            if (shell) {
                const shellRes = await axios.get(
                    `${shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/list`,
                    {
                        // Fetch extra so after ignore-filters we can still keep 100 newest.
                        params: { relativeDir: agentShellDir, maxFiles: 500 },
                        timeout: 10_000,
                        headers: { 'X-API-Token': shell.token },
                        validateStatus: () => true,
                    }
                );
                if (shellRes.status === 200 && shellRes.data && typeof shellRes.data === 'object') {
                    const body = shellRes.data as Record<string, unknown>;
                    shellWorkspaceListing = normalizeAgentShellListing({
                        rawFiles: body.files,
                        agentShellDir,
                        limit: AGENT_SHELL_CONTEXT_FILE_LIMIT,
                    });
                    for (const entry of shellWorkspaceListing) {
                        const abs = entry.absolutePath;
                        if (abs.includes('/agent/')) {
                            const idx = abs.indexOf('/agent/');
                            containerWorkingDir = abs.slice(0, idx);
                            agentFolderAbsolutePath = abs.slice(
                                0,
                                idx + `/agent/${agent.threadId}`.length
                            );
                            break;
                        }
                        if (abs.includes(`/${AGENT_WORKSPACE_SHELL_PREFIX}/`)) {
                            const idx = abs.indexOf(`/${AGENT_WORKSPACE_SHELL_PREFIX}/`);
                            containerWorkingDir = abs.slice(
                                0,
                                idx + `/${AGENT_WORKSPACE_SHELL_PREFIX}`.length
                            );
                        }
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
        .slice(0, 2500);
    const toolStdoutSummary = toolStdoutFromUpdates(recentUpdates) || recentToolSummary;
    const recentNoopCount = recentUpdates.filter(
        (u) => typeof u.message === 'string' && /\bnoop\b/i.test(u.message)
    ).length;
    const recentScriptOkCount = recentUpdates.filter(
        (u) =>
            u.updateType === 'script_executed' ||
            (u.updateType === 'tool_result' &&
                typeof u.message === 'string' &&
                /execute_script:\s*ok/i.test(u.message))
    ).length;

    const budget = computeAgentBudgetStatus({
        totalTokens: agent.totalTokens || 0,
        tickCount: tickNumber,
        limits: budgetLimitsFromAgentDoc(agent),
    });
    const budgetContext = formatAgentBudgetContext(budget);
    // Infinite-loop breaker: same successful script re-run while claiming done —
    // only force synthesize when the EXPECTED deliverable is already on disk.
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

    const { shellWorkspaceListing } = await loadShellListing(agent);

    const logCtx: AgentLogContext = {
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
    };

    const contextPack = await buildAgentContextPack({
        logCtx,
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
    });

    const goalExpansionDoc = await loadGoalExpansion(currentGoal._id as mongoose.Types.ObjectId);
    const goalExpansion = formatExpansionForPrompt(goalExpansionDoc);
    const expectsFile = expansionExpectsWorkspaceFile(goalExpansionDoc, `${currentGoal.title}\n${currentGoal.description || ''}`);
    const requiresPersonalData = goalExpansionDoc?.requiresPersonalData === true;
    const codingHint = [
        currentGoal.title || '',
        currentGoal.description || '',
        goalExpansionDoc?.suggestedApproach || '',
        ...(goalExpansionDoc?.suggestedSkills || []),
        ...(goalExpansionDoc?.acceptanceChecks || []),
    ]
        .join('\n')
        .toLowerCase();
    const prefersNodeArtifact =
        /code-nodejs|\.js\b|\.mjs\b|\.ts\b|javascript|typescript|nodejs|node\.js/.test(codingHint);
    const prefersDataTransform =
        /data-transform|csv|tsv|wrap lines|dedupe|uppercase|commas to tabs/.test(codingHint);
    const needsCodeDeliverable = goalRequiresCodeDeliverable(codingHint);
    const needsDbDeliverable = goalRequiresDatabaseDeliverable(codingHint);
    const codeOnDisk = listWorkspaceDeliverables(shellWorkspaceListing).some((d) =>
        /\.(js|mjs|cjs|ts|py)$/i.test(d.pathInAgentFolder.split('/').pop() || '')
    );
    const artifactDefaults = needsCodeDeliverable
        ? prefersNodeArtifact
            ? { scriptType: 'node' as const, fileName: 'app.js' }
            : { scriptType: 'python' as const, fileName: 'app.py' }
        : prefersNodeArtifact
          ? { scriptType: 'node' as const, fileName: 'create_artifact.js' }
          : { scriptType: 'python' as const, fileName: 'create_artifact.py' };
    const extraSkills = [
        ...(prefersNodeArtifact ? ['code-nodejs'] : []),
        ...(prefersDataTransform ? ['data-transform'] : []),
    ];
    const expectedExts = inferExpectedDeliverableExts({
        title: currentGoal.title,
        description: currentGoal.description || '',
        acceptanceChecks: goalExpansionDoc?.acceptanceChecks,
        expectations: goalExpansionDoc?.expectations as string[] | undefined,
        outputFormat: goalExpansionDoc?.outputFormat,
        suggestedApproach: goalExpansionDoc?.suggestedApproach,
    });
    const keepNamed = namedFilesFromGoalContext({
        title: currentGoal.title,
        description: currentGoal.description || '',
        outputFormat: goalExpansionDoc?.outputFormat,
        suggestedApproach: goalExpansionDoc?.suggestedApproach,
        expectations: goalExpansionDoc?.expectations as string[] | undefined,
        acceptanceChecks: goalExpansionDoc?.acceptanceChecks,
    });
    const baseline = await loadOrInitWorkspaceBaseline(agent, shellWorkspaceListing);
    const touchedExisting = toolTouchedWorkspaceFile({
        lastToolSummary: toolStdoutSummary,
        listing: shellWorkspaceListing,
        baselineSizesByName: baseline.sizesByName,
    });
    const workspaceDeliverables = mergeStdoutDeliverables({
        deliverables: filterNewDeliverables(
            listWorkspaceDeliverables(shellWorkspaceListing, { expectedExts }),
            baseline.paths,
            keepNamed,
            baseline.sizesByName
        ),
        toolSummary: toolStdoutSummary,
        baselinePaths: baseline.paths,
        expectedExts,
    });
    const dbOnDisk = hasDatabaseDeliverableEvidence(shellWorkspaceListing, workspaceDeliverables);
    const hasRepoCloneEvidence = shellWorkspaceListing.some(
        (f) => !f.isDir && /\/\.git\/HEAD$/i.test(String(f.relativePath || ''))
    ) && shellWorkspaceListing.some(
        (f) =>
            !f.isDir &&
            /(^|\/)README(\.md|\.txt)?$/i.test(
                String(f.pathInAgentFolder || f.relativePath || '').replace(/\\/g, '/')
            )
    );
    const hasAnyNewDeliverable =
        workspaceDeliverables.length > 0 ||
        (hasRepoCloneEvidence &&
            (expectedExts.length === 0 || expectedExts.some((e) => /^(md|txt)$/i.test(e))));
    const emptyNamedOutputs = namedOutputsEmptyOnDisk(shellWorkspaceListing, keepNamed).filter(
        (n) =>
            !workspaceDeliverables.some(
                (d) =>
                    d.size > 0 &&
                    (d.pathInAgentFolder.replace(/\\/g, '/').split('/').pop() || '').toLowerCase() ===
                        n.toLowerCase()
            )
    );
    const hasFileDeliverable =
        emptyNamedOutputs.length === 0 &&
        (!needsDbDeliverable || dbOnDisk) &&
        (needsCodeDeliverable
            ? codeOnDisk
            : (hasAnyNewDeliverable || touchedExisting) &&
              (expectsFile || prefersDataTransform || prefersNodeArtifact || touchedExisting));
    const defaultAction =
        (goalExpansionDoc?.suggestedTools || [])[0] ||
        (expectsFile ? 'execute_script' : requiresPersonalData ? 'search_all_domains' : 'search_all_domains');
    const IMAGE_TO_TEXT_ACTIONS = new Set(['image_to_text', 'ocr_image', 'ocr', 'vision_ocr', 'image_ocr']);
    const planIsImageToText = (action?: string): boolean =>
        IMAGE_TO_TEXT_ACTIONS.has(String(action || '').toLowerCase());
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
                  `pastGoals: ${JSON.stringify(pastGoalsForPrompt).slice(0, 1200)}`,
              ]
                  .filter(Boolean)
                  .join('\n'),
              contextPack: contextPack.formatted,
              chatMessages: contextPack.chatWindow,
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
            scriptType: expectsFile ? artifactDefaults.scriptType : undefined,
            fileName: expectsFile ? artifactDefaults.fileName : undefined,
            skillsToLoad: Array.from(
                new Set([
                    ...(plan.skillsToLoad || []),
                    ...(goalExpansionDoc?.suggestedSkills || []),
                ])
            ).slice(0, 3),
        };
    }

    // Specs/fixtures only: do not loop inspect/find scripts. Write the deliverable.
    const inspectishName =
        /^(script_\d+|plan_probe|tmp_|read_|analyze_|inspect_|debug_|probe_|check_|list_|cat_|find_|search_|scan_|locate_|walk_|discover_|investigate_|discovery_|identify_)/i;
    const planFileRaw =
        plan.kind === 'expand_goals'
            ? ''
            : String(
                  ('fileName' in plan && plan.fileName) ||
                      ('query' in plan && plan.query) ||
                      ''
              );
    const planFile = planFileRaw.replace(/\\/g, '/').split('/').pop() || '';
    const planLooksInspect =
        inspectishName.test(planFile) ||
        /^\s*cat\s+/i.test(planFileRaw) ||
        /\bcat\s+[\w./-]+\b/i.test(planFileRaw) ||
        /^\s*ls(\s|$)/i.test(planFileRaw);
    const planIsListWorkspace =
        plan.kind === 'use_tool' &&
        /list_workspace_files|list_files|list_workspace/.test(String(plan.action || ''));
    if (
        expectsFile &&
        !requiresPersonalData &&
        !hasFileDeliverable &&
        !budget.maxExceeded &&
        tickNumber >= 1 &&
        !planIsImageToText(plan.kind === 'use_tool' ? plan.action : undefined) &&
        !planIsImageToText(defaultAction) &&
        (plan.kind === 'final_answer' ||
            planLooksInspect ||
            planIsListWorkspace ||
            tickNumber >= 3 ||
            emptyNamedOutputs.length > 0)
    ) {
        plan = {
            kind: 'use_tool',
            mode: 'use_tool',
            action: 'execute_script',
            query: currentGoal.description || currentGoal.title,
            reason:
                emptyNamedOutputs.length > 0
                    ? `Named output is empty (${emptyNamedOutputs.join(', ')}) — write real content, then print path + size.`
                    : 'No workspace deliverable yet — write the implementation now. Do not search for a missing stub.',
            scriptType: artifactDefaults.scriptType,
            fileName: artifactDefaults.fileName,
            code: '',
            skillsToLoad: Array.from(
                new Set([
                    ...activeSkillNames,
                    ...(goalExpansionDoc?.suggestedSkills || []),
                    'shell-environment',
                    ...(prefersNodeArtifact ? ['code-nodejs'] : []),
                    ...(prefersDataTransform ? ['data-transform'] : []),
                ])
            ).slice(0, 4),
        };
    }

    const planLooksRootFind = /\bfind\s+\//i.test(planFileRaw);
    if (planLooksRootFind && !budget.maxExceeded && plan.kind === 'use_tool') {
        plan = {
            kind: 'use_tool',
            mode: 'use_tool',
            action: 'execute_script',
            query: currentGoal.description || currentGoal.title,
            reason:
                'Do not search the whole filesystem. Use list_workspace_files to locate files.',
            scriptType: artifactDefaults.scriptType,
            fileName: prefersDataTransform ? 'create_artifact.py' : artifactDefaults.fileName,
            code: '',
            skillsToLoad: Array.from(
                new Set([
                    ...activeSkillNames,
                    ...(goalExpansionDoc?.suggestedSkills || []),
                    'shell-environment',
                    ...(prefersDataTransform ? ['data-transform'] : []),
                ])
            ).slice(0, 4),
        };
    }

    // Parent rollup: once every child is completed, finalize — do not keep validating / re-running tools.
    // Exception: file deliverables still need a real workspace file (children can hallucinate success).
    const childGoals = goals.filter(
        (g) => g.parentGoalId && String(g.parentGoalId) === String(currentGoal._id)
    );
    const allChildrenCompleted =
        childGoals.length > 0 && childGoals.every((c) => c.status === 'completed');
    const childResultsLookFake = childGoals.some((c) => looksLikeUnexecutedToolPlan(c.result || ''));
    if (allChildrenCompleted && Boolean(childResultsPack) && !budget.maxExceeded) {
        if ((expectsFile && !hasFileDeliverable) || childResultsLookFake) {
            plan = {
                kind: 'use_tool',
                mode: 'use_tool',
                action: 'execute_script',
                query: currentGoal.description || currentGoal.title,
                reason: childResultsLookFake
                    ? 'Child result looks like an unexecuted tool plan — run execute_script for real'
                    : 'Children marked done but no workspace deliverable on disk — create the file and print absolute path + size',
                scriptType: artifactDefaults.scriptType,
                fileName: artifactDefaults.fileName,
                skillsToLoad: Array.from(
                    new Set([
                        ...activeSkillNames,
                        ...(goalExpansionDoc?.suggestedSkills || []),
                        'shell-environment',
                        ...(prefersNodeArtifact ? ['code-nodejs'] : []),
                        ...(prefersDataTransform ? ['data-transform'] : []),
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
            scriptType: expectsFile ? artifactDefaults.scriptType : undefined,
            fileName: expectsFile ? artifactDefaults.fileName : undefined,
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
            const nextAction = planIsImageToText(defaultAction)
                ? 'image_to_text'
                : artifactGate.suggestedNextAction || 'execute_script';
            plan = {
                kind: 'use_tool',
                mode: 'use_tool',
                action: nextAction,
                query: currentGoal.description || currentGoal.title,
                reason: artifactGate.reason,
                scriptType: planIsImageToText(nextAction) ? undefined : artifactDefaults.scriptType,
                fileName: planIsImageToText(nextAction) ? undefined : artifactDefaults.fileName,
                skillsToLoad: Array.from(
                    new Set([
                        ...(plan.skillsToLoad || []),
                        ...(goalExpansionDoc?.suggestedSkills || []),
                        'shell-environment',
                        ...(prefersNodeArtifact ? ['code-nodejs'] : []),
                        ...(prefersDataTransform ? ['data-transform'] : []),
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

    // Chat/text: after a couple of successful scripts, stop inventing verify loops.
    const sameNextStepCount = memories.filter((m) => /^next_step_/i.test(m.key)).length;
    if (
        !forceSynthesize &&
        !budget.maxExceeded &&
        budget.minsMet &&
        plan.kind !== 'final_answer' &&
        recentScriptOkCount >= 2 &&
        ((isChatOrTextGoal(goalExpansionDoc?.outputFormat) && !expectsFile) ||
            sameNextStepCount >= 3)
    ) {
        plan = {
            kind: 'final_answer',
            mode: 'final_answer',
            reason:
                isChatOrTextGoal(goalExpansionDoc?.outputFormat) && !expectsFile
                    ? 'Chat goal already has successful tool output — synthesize the answer'
                    : 'Same next_step repeated — stop looping and synthesize',
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
        relativePath: plan.kind === 'use_tool' ? plan.relativePath : undefined,
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

    const verifyContextPack = await buildAgentContextPack({
        logCtx,
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
    });

    const budgetContext = formatAgentBudgetContext(
        computeAgentBudgetStatus({
            totalTokens: agent.totalTokens || 0,
            tickCount: tickNumber,
            limits: budgetLimitsFromAgentDoc(agent),
        })
    );

    const goalExpansionDoc = await loadGoalExpansion(currentGoal._id as mongoose.Types.ObjectId);
    const goalExpansion = formatExpansionForPrompt(goalExpansionDoc);

    // Check disk first — skip expensive verify LLM when the EXPECTED deliverable exists.
    let deliverableReady = false;
    let diskDeliverables: ReturnType<typeof listWorkspaceDeliverables> = [];
    const expectedExtsObserve = inferExpectedDeliverableExts({
        title: currentGoal.title,
        description: currentGoal.description || '',
        acceptanceChecks: goalExpansionDoc?.acceptanceChecks,
        expectations: goalExpansionDoc?.expectations as string[] | undefined,
        outputFormat: goalExpansionDoc?.outputFormat,
        suggestedApproach: goalExpansionDoc?.suggestedApproach,
    });
    if (expansionExpectsWorkspaceFile(goalExpansionDoc, `${currentGoal.title}\n${currentGoal.description || ''}`) || toolSuccess) {
        const { shellWorkspaceListing } = await loadShellListing(agent);
        const baseline = await loadOrInitWorkspaceBaseline(agent, shellWorkspaceListing);
        const keepNamedObserve = namedFilesFromGoalContext({
            title: currentGoal.title,
            description: currentGoal.description || '',
            outputFormat: goalExpansionDoc?.outputFormat,
            suggestedApproach: goalExpansionDoc?.suggestedApproach,
            expectations: goalExpansionDoc?.expectations as string[] | undefined,
            acceptanceChecks: goalExpansionDoc?.acceptanceChecks,
        });
        const touchedExisting = toolTouchedWorkspaceFile({
            lastToolSummary: toolResultSummary,
            listing: shellWorkspaceListing,
            baselineSizesByName: baseline.sizesByName,
        });
        diskDeliverables = mergeStdoutDeliverables({
            deliverables: filterNewDeliverables(
                listWorkspaceDeliverables(shellWorkspaceListing, {
                    expectedExts: expectedExtsObserve,
                }),
                baseline.paths,
                keepNamedObserve,
                baseline.sizesByName
            ),
            toolSummary: toolResultSummary,
            baselinePaths: baseline.paths,
            expectedExts: expectedExtsObserve,
        });
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
        if (touchedExisting && diskDeliverables.length === 0) {
            diskDeliverables = listWorkspaceDeliverables(shellWorkspaceListing, {
                expectedExts: expectedExtsObserve,
            })
                .filter((d) =>
                    fileSizeChangedFromBaseline(d.pathInAgentFolder, d.size, baseline.sizesByName)
                )
                .slice(0, 8);
        }
        diskDeliverables = mergeStdoutDeliverables({
            deliverables: diskDeliverables,
            toolSummary: toolResultSummary,
            baselinePaths: baseline.paths,
            expectedExts: expectedExtsObserve,
        });
        deliverableReady =
            diskDeliverables.length > 0 ||
            touchedExisting ||
            (hasRepoCloneEvidence &&
                (expectedExtsObserve.length === 0 ||
                    expectedExtsObserve.some((e) => /^(md|txt)$/i.test(e))));
        const observeNeedsCode = goalRequiresCodeDeliverable(
            [
                currentGoal.title || '',
                currentGoal.description || '',
                goalExpansionDoc?.suggestedApproach || '',
                ...(goalExpansionDoc?.acceptanceChecks || []),
                ...(Array.isArray(goalExpansionDoc?.expectations)
                    ? goalExpansionDoc.expectations
                    : []),
            ].join('\n')
        );
        if (
            observeNeedsCode &&
            !listWorkspaceDeliverables(shellWorkspaceListing).some((d) =>
                /\.(js|mjs|cjs|ts|py)$/i.test(d.pathInAgentFolder.split('/').pop() || '')
            )
        ) {
            deliverableReady = false;
        }
        const observeNeedsDb = goalRequiresDatabaseDeliverable(
            [
                currentGoal.title || '',
                currentGoal.description || '',
                goalExpansionDoc?.suggestedApproach || '',
                ...(goalExpansionDoc?.acceptanceChecks || []),
                ...(Array.isArray(goalExpansionDoc?.expectations)
                    ? goalExpansionDoc.expectations
                    : []),
            ].join('\n')
        );
        if (observeNeedsDb && !hasDatabaseDeliverableEvidence(shellWorkspaceListing, diskDeliverables)) {
            deliverableReady = false;
        }
        const emptyNamedObserve = namedOutputsEmptyOnDisk(shellWorkspaceListing, keepNamedObserve).filter(
            (n) =>
                !diskDeliverables.some(
                    (d) =>
                        d.size > 0 &&
                        (d.pathInAgentFolder.replace(/\\/g, '/').split('/').pop() || '').toLowerCase() ===
                            n.toLowerCase()
                )
        );
        if (emptyNamedObserve.length > 0) {
            deliverableReady = false;
        }
    }

    let verify: AgentVerifyVerdict;
    const observeIsChatAnswer =
        isChatOrTextGoal(goalExpansionDoc?.outputFormat) &&
        !expansionExpectsWorkspaceFile(goalExpansionDoc, `${currentGoal.title}\n${currentGoal.description || ''}`) &&
        toolSuccess &&
        toolOutputLooksLikeChatAnswer(toolResultSummary);
    if (observeIsChatAnswer && !forceSynthesize) {
        verify = {
            verdict: 'ready_to_synthesize',
            reason: 'Chat/text goal: tool already printed the answer',
            evidenceGaps: [],
        };
    } else if (deliverableReady && !forceSynthesize) {
        const evidence = toolEvidenceSupportsDeliverables({
            lastToolSummary: toolResultSummary,
            deliverables: diskDeliverables,
            expectedExts: expectedExtsObserve,
            acceptanceChecks: goalExpansionDoc?.acceptanceChecks || [],
        });
        if (evidence.ok) {
            const names = diskDeliverables
                .map((d) => `${d.pathInAgentFolder} (${d.size}b)`)
                .slice(0, 3)
                .join(', ');
            verify = {
                verdict: 'ready_to_synthesize',
                reason: `Verified deliverable on disk (${names}) — ${evidence.reason}`.slice(0, 200),
                evidenceGaps: [],
            };
        } else {
            // File present but weak evidence — still call verify LLM once, biased to continue/verify
            verify = await verifyAgentStep({
                logCtx,
                llmConfig,
                goalTitle: currentGoal.title,
                goalDescription: currentGoal.description || currentGoal.title,
                lastAction,
                lastResultSummary: `${toolResultSummary}\n\n[deterministic] ${evidence.reason}`,
                memorySummary: formatMemorySummary(verifyMemMapped),
                activeSkillsBlock,
                budgetContext,
                goalExpansion,
                contextPack: verifyContextPack.formatted,
                chatMessages: verifyContextPack.chatWindow,
            });
            if (verify.verdict === 'ready_to_synthesize' && !forceSynthesize) {
                // Require a cheap content/path print before trusting LLM
                verify = {
                    ...verify,
                    verdict: 'continue',
                    reason: evidence.reason.slice(0, 200),
                    suggestedNextAction: 'execute_script',
                    suggestedQuery:
                        'Print absolute path, size, and first 5 lines of the expected output file to verify contents, then stop.',
                    evidenceGaps: [evidence.reason],
                };
            }
        }
    } else {
        verify = await verifyAgentStep({
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
            contextPack: verifyContextPack.formatted,
            chatMessages: verifyContextPack.chatWindow,
        });
    }

    verify = applyEvidenceGate({
        verify,
        memories: verifyMemMapped,
        requiresPersonalData: goalExpansionDoc?.requiresPersonalData === true,
        forceSynthesize,
        tickNumber,
    });

    verify = applyArtifactGate({
        verify,
        memories: verifyMemMapped,
        expectsWorkspaceFile: expansionExpectsWorkspaceFile(goalExpansionDoc, `${currentGoal.title}\n${currentGoal.description || ''}`),
        acceptanceChecks: goalExpansionDoc?.acceptanceChecks || [],
        forceSynthesize,
        lastToolSummary: toolResultSummary,
        workspaceHasDeliverable: deliverableReady,
    });

    // Finalize only when disk + tool evidence agree (unless forced by budget max).
    if (!forceSynthesize && deliverableReady && verify.verdict === 'ready_to_synthesize') {
        const evidence = toolEvidenceSupportsDeliverables({
            lastToolSummary: toolResultSummary,
            deliverables: diskDeliverables,
            expectedExts: expectedExtsObserve,
            acceptanceChecks: goalExpansionDoc?.acceptanceChecks || [],
        });
        if (evidence.ok) {
            const names = diskDeliverables
                .map((d) => `${d.pathInAgentFolder} (${d.size}b)`)
                .slice(0, 3)
                .join(', ');
            verify = {
                ...verify,
                verdict: 'ready_to_synthesize',
                reason: `Deliverable verified — finalize (${names})`.slice(0, 200),
                evidenceGaps: [],
                suggestedNextAction: undefined,
                retryHint: undefined,
            };
        } else {
            verify = {
                ...verify,
                verdict: 'continue',
                reason: evidence.reason.slice(0, 200),
                suggestedNextAction: 'execute_script',
                suggestedQuery:
                    'Verify the output file: print absolute path, size, and a short content sniff (first lines / magic header).',
                evidenceGaps: [evidence.reason],
            };
        }
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

    const synthContextPack = await buildAgentContextPack({
        logCtx,
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
    });

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

    const expectedExtsSynth = inferExpectedDeliverableExts({
        title: currentGoal.title,
        description: currentGoal.description || '',
        acceptanceChecks: goalExpansionDoc?.acceptanceChecks,
        expectations: goalExpansionDoc?.expectations as string[] | undefined,
        outputFormat: goalExpansionDoc?.outputFormat,
        suggestedApproach: goalExpansionDoc?.suggestedApproach,
    });
    const { shellWorkspaceListing: synthListing } = await loadShellListing(agent);
    const synthBaseline = await loadOrInitWorkspaceBaseline(agent, synthListing);
    const recentSynthUpdates = await ModelAgentUpdate.find({ agentInstanceId: id })
        .sort({ createdAtUtc: -1 })
        .limit(12);
    const synthToolSummary = [
        toolStdoutFromUpdates(recentSynthUpdates),
        formatMemorySummary(memMapped).slice(0, 8000),
        recentSynthUpdates.map((u) => `- [${u.updateType}] ${u.message}`).join('\n').slice(0, 4000),
    ]
        .filter(Boolean)
        .join('\n');
    const synthTouched = toolTouchedWorkspaceFile({
        lastToolSummary: synthToolSummary,
        listing: synthListing,
        baselineSizesByName: synthBaseline.sizesByName,
    });
    const synthKeepNamed = namedFilesFromGoalContext({
        title: currentGoal.title,
        description: currentGoal.description || '',
        outputFormat: goalExpansionDoc?.outputFormat,
        suggestedApproach: goalExpansionDoc?.suggestedApproach,
        expectations: goalExpansionDoc?.expectations as string[] | undefined,
        acceptanceChecks: goalExpansionDoc?.acceptanceChecks,
    });
    const expectedDiskDeliverables = mergeStdoutDeliverables({
        deliverables: filterNewDeliverables(
            listWorkspaceDeliverables(synthListing, { expectedExts: expectedExtsSynth }),
            synthBaseline.paths,
            synthKeepNamed,
            synthBaseline.sizesByName
        ),
        toolSummary: synthToolSummary,
        baselinePaths: synthBaseline.paths,
        expectedExts: expectedExtsSynth,
    });
    // Citation list: all new non-helpers (not just expected exts) so synthesize cannot invent a .py when only .js was gated.
    let verifiedDiskDeliverables = mergeStdoutDeliverables({
        deliverables: filterNewDeliverables(
            listWorkspaceDeliverables(synthListing),
            synthBaseline.paths,
            synthKeepNamed,
            synthBaseline.sizesByName
        ),
        toolSummary: synthToolSummary,
        baselinePaths: synthBaseline.paths,
    });
    if (verifiedDiskDeliverables.length === 0 && synthTouched) {
        verifiedDiskDeliverables = listWorkspaceDeliverables(synthListing)
            .filter((d) =>
                fileSizeChangedFromBaseline(d.pathInAgentFolder, d.size, synthBaseline.sizesByName)
            )
            .slice(0, 12);
    }
    if (verifiedDiskDeliverables.length === 0) {
        verifiedDiskDeliverables = expectedDiskDeliverables;
    }
    verifiedDiskDeliverables = mergeStdoutDeliverables({
        deliverables: verifiedDiskDeliverables,
        toolSummary: synthToolSummary,
        baselinePaths: synthBaseline.paths,
    });

    const synthGoalBlob = [
        currentGoal.title || '',
        currentGoal.description || '',
        goalExpansionDoc?.suggestedApproach || '',
        ...(goalExpansionDoc?.acceptanceChecks || []),
        ...(Array.isArray(goalExpansionDoc?.expectations) ? goalExpansionDoc.expectations : []),
    ].join('\n');
    const synthNeedsCode = goalRequiresCodeDeliverable(synthGoalBlob);
    const synthNeedsDb = goalRequiresDatabaseDeliverable(synthGoalBlob);
    const synthCodeDeliverables = listWorkspaceDeliverables(synthListing).filter((d) =>
        /\.(js|mjs|cjs|ts|py)$/i.test(d.pathInAgentFolder.split('/').pop() || '')
    );

    const synthEmptyNamed = namedOutputsEmptyOnDisk(synthListing, synthKeepNamed).filter(
        (n) =>
            !verifiedDiskDeliverables.some(
                (d) =>
                    d.size > 0 &&
                    (d.pathInAgentFolder.replace(/\\/g, '/').split('/').pop() || '').toLowerCase() ===
                        n.toLowerCase()
            )
    );

    // Hard stop: do not claim success for a file goal when the expected file is missing.
    if (
        expansionExpectsWorkspaceFile(goalExpansionDoc, `${currentGoal.title}\n${currentGoal.description || ''}`) &&
        ((!isChildGoal &&
            expectedDiskDeliverables.length === 0 &&
            verifiedDiskDeliverables.length === 0 &&
            !synthTouched) ||
            (synthNeedsCode && synthCodeDeliverables.length === 0) ||
            (synthNeedsDb && !hasDatabaseDeliverableEvidence(synthListing, verifiedDiskDeliverables)) ||
            synthEmptyNamed.length > 0)
    ) {
        const budgetNow = computeAgentBudgetStatus({
            totalTokens: agent.totalTokens || 0,
            tickCount: tickNumber,
            limits: budgetLimitsFromAgentDoc(agent),
        });
        if (!budgetNow.maxExceeded) {
            await writeUpdate({
                agentInstanceId: id,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'verify',
                message: `Blocked finalize — expected deliverable missing (${expectedExtsSynth.join('|') || 'file'}). Continuing.`,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
            });
            if (placeholderId) {
                try {
                    await ModelChatLlm.findByIdAndDelete(placeholderId);
                } catch {
                    /* ignore */
                }
            }
            // Clear streaming placeholder and force another tool tick instead of hallucinating.
            await ModelAgentInstance.findByIdAndUpdate(id, {
                $set: {
                    brainStep: 'use_tool',
                    statusIsRunning: false,
                    updatedAtUtc: new Date(),
                },
            });
            return;
        }
    }

    let answer = '';
    try {
        answer = await synthesizeAgentAnswer({
            logCtx,
            llmConfig,
            goalTitle: currentGoal.title,
            goalDescription: currentGoal.description || currentGoal.title,
            memorySummary: formatMemorySummary(memMapped),
            pastChatSummary: synthContextPack.actions
                .filter((a) => a.kind === 'chat_user' || a.kind === 'chat_assistant')
                .slice(-20)
                .map((a) => `${a.kind === 'chat_user' ? 'user' : 'assistant'}: ${a.body}`)
                .join('\n')
                .slice(0, 3000),
            contextPack: synthContextPack.formatted,
            chatMessages: synthContextPack.chatWindow,
            activeSkillsBlock,
            chatMessageId: placeholderId || undefined,
            budgetContext,
            goalExpansion,
            childResultsPack: childResultsPack || undefined,
            verifiedDiskDeliverables,
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

    if (looksLikeUnexecutedToolPlan(answer) || looksLikeIncompleteProgress(answer)) {
        const budgetNow = computeAgentBudgetStatus({
            totalTokens: agent.totalTokens || 0,
            tickCount: tickNumber,
            limits: budgetLimitsFromAgentDoc(agent),
        });
        if (!budgetNow.maxExceeded) {
            await writeUpdate({
                agentInstanceId: id,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'verify',
                message: looksLikeUnexecutedToolPlan(answer)
                    ? 'Blocked finalize — synthesize returned an unexecuted tool plan. Running execute_script instead.'
                    : 'Blocked finalize — synthesize was a progress report, not a completed deliverable. Continue implementing.',
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
            });
            if (placeholderId) {
                try {
                    await ModelChatLlm.findByIdAndDelete(placeholderId);
                } catch {
                    /* ignore */
                }
            }
            await ModelAgentInstance.findByIdAndUpdate(id, {
                $set: {
                    brainStep: 'use_tool',
                    statusIsRunning: false,
                    updatedAtUtc: new Date(),
                },
            });
            return;
        }
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
