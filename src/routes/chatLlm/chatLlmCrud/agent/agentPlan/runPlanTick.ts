/**
 * PLAN helpers used by the Agent Brain (goal probes + expansion).
 * Does not own the outer loop — brain tick calls this when goals need expansion.
 */
import mongoose from 'mongoose';

import { ModelAgentInstance } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import writeAgentLog, { type AgentLogContext } from '../agentUtils/agentWriteLog';
import { writeUpdate } from '../agentWork/agentToolRegistry';
import { decidePlanStep } from './decidePlanStep';
import { appendPlanContextMemory, runPlanProbes } from './runPlanProbes';
import { expandGoalsInPlanStage, loadPlanContextBundle } from './expandGoals';
import { buildAgentContextPack } from '../agentUtils/agentContextWindow';

const MAX_PLAN_PROBES = 8;

export type PlanTickResult = {
    /** True when probes ran and brain should think/plan again next tick */
    needsAnotherTick: boolean;
};

export const runPlanTick = async (
    agentInstanceId: mongoose.Types.ObjectId | string
): Promise<PlanTickResult> => {
    const agent = await ModelAgentInstance.findById(agentInstanceId);
    if (!agent) {
        throw new Error(`Agent run not found: ${String(agentInstanceId)}`);
    }

    const id = agent._id as mongoose.Types.ObjectId;
    const tickNumber = agent.tickCount || 0;
    const logCtx: AgentLogContext = {
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        tickNumber,
    };

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'status',
        message: `Brain: plan expand/probe (tick ${tickNumber})`,
        tickNumber,
        payload: { brainStep: 'plan' },
    });
    await writeAgentLog({
        ...logCtx,
        action: 'brain_plan',
        message: 'Plan — probe and/or expand goals',
        tickNumber,
    });

    const { planContext, probeCount, userRequest } = await loadPlanContextBundle(id);
    const tops = await ModelAgentGoal.find({
        agentInstanceId: id,
        parentGoalId: null,
    })
        .sort({ orderIndex: 1 })
        .limit(20);
    const goalsSummary = tops.map((g, i) => `${i + 1}. ${g.title}: ${g.description || ''}`).join('\n');

    const contextPack = await buildAgentContextPack({
        logCtx,
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
    });

    const decision = await decidePlanStep({
        logCtx,
        userRequest,
        goalsSummary,
        existingPlanContext: planContext,
        probeCount,
        maxProbes: MAX_PLAN_PROBES,
        contextPack: contextPack.formatted,
        chatMessages: contextPack.chatWindow,
    });

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'plan',
        message: `Plan decide: ${decision.mode} — ${decision.reason}`,
        tickNumber,
        payload: {
            brainStep: 'plan',
            mode: decision.mode,
            reason: decision.reason,
            probeCount: decision.probes.length,
        },
    });

    if (decision.mode === 'probe') {
        const probeSummaries = await runPlanProbes({
            agent,
            logCtx,
            probes: decision.probes,
            fallbackGoal: tops[0] || null,
        });
        const nextContext = await appendPlanContextMemory({
            agent,
            tickNumber,
            contextNotes: decision.contextNotes,
            probeSummaries,
        });

        await writeUpdate({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'status',
            message: `Plan probes done (${probeSummaries.length}) — brain will repeat`,
            tickNumber,
            payload: {
                brainStep: 'plan',
                probeSummaries: probeSummaries.slice(0, 5),
                planContextChars: nextContext.length,
            },
        });

        await ModelAgentInstance.findByIdAndUpdate(id, {
            $set: { brainStep: 'plan', updatedAtUtc: new Date() },
        });
        return { needsAnotherTick: true };
    }

    const latest = await loadPlanContextBundle(id);
    const mergedContext = [
        latest.planContext,
        decision.contextNotes ? `Planner notes: ${decision.contextNotes}` : '',
    ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 12000);

    if (decision.contextNotes) {
        await appendPlanContextMemory({
            agent,
            tickNumber,
            contextNotes: decision.contextNotes,
            probeSummaries: [],
        });
    }

    await expandGoalsInPlanStage({
        agent,
        logCtx,
        userRequest: latest.userRequest || userRequest,
        planContext: mergedContext,
        isReplan: agent.brainStep === 'plan' && tickNumber > 2,
    });

    await ModelAgentInstance.findByIdAndUpdate(id, {
        $set: { brainStep: 'plan', updatedAtUtc: new Date() },
    });
    return { needsAnotherTick: false };
};

export default runPlanTick;
