/**
 * Agent Brain tick:
 * User Request → [Think → Plan → Use Tool → Observe → Repeat] → Final Answer
 */
import mongoose from 'mongoose';

import { ModelAgentInstance } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { loadGoalExpansion } from '../agentPlan/agentGoalExpand';
import { runPlanTick } from '../agentPlan/runPlanTick';
import {
    agentTickPlan,
    agentTickPrepareGoal,
    agentTickRunTool,
    agentTickSynthesize,
    agentTickVerify,
} from '../agentWork/agentTickSteps';
import { writeUpdate } from '../agentWork/agentToolRegistry';
import type { AgentBrainStep } from '../agentUtils/agentBrainStep';
import writeAgentLog from '../agentUtils/agentWriteLog';

const setBrainStep = async (
    id: mongoose.Types.ObjectId,
    brainStep: AgentBrainStep
): Promise<void> => {
    await ModelAgentInstance.findByIdAndUpdate(id, {
        $set: { brainStep, updatedAtUtc: new Date() },
    });
};

const goalsNeedExpansion = async (agentInstanceId: mongoose.Types.ObjectId): Promise<boolean> => {
    const tops = await ModelAgentGoal.find({
        agentInstanceId,
        parentGoalId: null,
        status: { $in: ['pending', 'in_progress'] },
    })
        .select('_id')
        .limit(20)
        .lean();
    if (tops.length === 0) return false;
    for (const g of tops) {
        const exp = await loadGoalExpansion(g._id as mongoose.Types.ObjectId);
        if (!exp) return true;
    }
    return false;
};

export const runBrainTick = async (
    agentInstanceId: mongoose.Types.ObjectId | string
): Promise<void> => {
    const agent = await ModelAgentInstance.findById(agentInstanceId);
    if (!agent) {
        throw new Error(`Agent run not found: ${String(agentInstanceId)}`);
    }

    const id = agent._id as mongoose.Types.ObjectId;
    const tickNumber = agent.tickCount || 0;

    // --- Think ---
    await setBrainStep(id, 'think');
    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'status',
        message: `Brain: think (tick ${tickNumber})`,
        tickNumber,
        payload: { brainStep: 'think' },
    });
    await writeAgentLog({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        action: 'brain_think',
        message: 'Think — assess goals, memory, and next move',
        tickNumber,
    });

    // --- Plan (goal expansion / probes when needed) ---
    await setBrainStep(id, 'plan');
    const needExpand = await goalsNeedExpansion(id);
    if (needExpand) {
        const planResult = await runPlanTick(agentInstanceId);
        if (planResult.needsAnotherTick) {
            // Still gathering context via probes — repeat next tick.
            await setBrainStep(id, 'plan');
            return;
        }
    }

    await agentTickPrepareGoal(agentInstanceId);

    // --- Plan (choose use_tool | expand_goals | final_answer) ---
    const decision = await agentTickPlan(agentInstanceId);

    if (decision === 'expand_goals') {
        await setBrainStep(id, 'plan');
        await writeUpdate({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'status',
            message: 'Brain: expand_goals — revising plan',
            tickNumber,
            payload: { brainStep: 'plan', decision: 'expand_goals' },
        });
        await runPlanTick(agentInstanceId);
        return;
    }

    if (decision === 'final_answer') {
        // Optional check script, then observe, then final answer.
        await setBrainStep(id, 'use_tool');
        await agentTickRunTool(agentInstanceId);
        await setBrainStep(id, 'observe');
        const verdict = await agentTickVerify(agentInstanceId);
        if (verdict === 'retry') {
            await setBrainStep(id, 'plan');
            return;
        }
        await setBrainStep(id, 'final_answer');
        await agentTickSynthesize(agentInstanceId, 'Brain: final_answer');
        return;
    }

    // --- Use Tool ---
    await setBrainStep(id, 'use_tool');
    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'status',
        message: 'Brain: use_tool',
        tickNumber,
        payload: { brainStep: 'use_tool' },
    });
    await agentTickRunTool(agentInstanceId);

    // --- Observe ---
    await setBrainStep(id, 'observe');
    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'status',
        message: 'Brain: observe',
        tickNumber,
        payload: { brainStep: 'observe' },
    });
    const verdict = await agentTickVerify(agentInstanceId);
    if (verdict === 'ready_to_synthesize') {
        await setBrainStep(id, 'final_answer');
        await agentTickSynthesize(agentInstanceId, 'Brain: observe → final_answer');
        return;
    }

    // Repeat on next tick
    await setBrainStep(id, 'plan');
};

export default runBrainTick;
