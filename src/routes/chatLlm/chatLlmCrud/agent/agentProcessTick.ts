/**
 * One Agent Brain tick.
 *
 * User Request → Agent Brain [Think → Plan → Use Tool → Observe → Repeat] → Final Answer
 *
 * Re-enqueues while status === pending until goals finish or budget forces final answer.
 */
import mongoose from 'mongoose';

import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import {
    agentTickClaim,
    agentTickFail,
    agentTickFinishIfDone,
    agentTickHandleCancel,
    agentTickRelease,
    agentTickSynthesize,
} from './agentWork/agentTickSteps';
import { runBrainTick } from './agentBrain/runBrainTick';
import {
    budgetLimitsFromAgentDoc,
    computeAgentBudgetStatus,
} from './agentStats/agentBudget';
import writeAgentLog from './agentUtils/agentWriteLog';
import { writeUpdate } from './agentWork/agentToolRegistry';

export const agentProcessTick = async (
    agentInstanceId: mongoose.Types.ObjectId | string
): Promise<void> => {
    const claimed = await agentTickClaim(agentInstanceId);
    if (!claimed) {
        return;
    }

    try {
        if (await agentTickHandleCancel(agentInstanceId)) {
            return;
        }

        const agent = await ModelAgentInstance.findById(agentInstanceId);
        if (!agent) {
            return;
        }

        const id = agent._id as mongoose.Types.ObjectId;
        const tickNumber = agent.tickCount || 0;

        if (agent.brainStep === 'done' || agent.status !== 'pending') {
            await agentTickFinishIfDone(agentInstanceId);
            return;
        }

        const budget = computeAgentBudgetStatus({
            totalTokens: agent.totalTokens || 0,
            tickCount: tickNumber,
            limits: budgetLimitsFromAgentDoc(agent),
        });

        if (budget.maxExceeded) {
            await writeUpdate({
                agentInstanceId: id,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'status',
                message: 'Budget max reached — forcing final_answer then done',
                tickNumber,
                payload: {
                    brainStep: 'final_answer',
                    budgetMaxExceeded: true,
                },
            });
            await writeAgentLog({
                agentInstanceId: id,
                userId: agent.userId,
                threadId: agent.threadId,
                action: 'budget_max_force_exit',
                message: 'Budget max reached; synthesizing then done',
                tickNumber,
            });

            try {
                await ModelAgentInstance.findByIdAndUpdate(id, {
                    $set: { brainStep: 'final_answer', updatedAtUtc: new Date() },
                });
                await agentTickSynthesize(agentInstanceId, 'Budget max — final answer');
            } catch (e) {
                console.error('budget-forced synthesize failed:', e);
            }

            await ModelAgentInstance.findByIdAndUpdate(id, {
                $set: {
                    brainStep: 'done',
                    updatedAtUtc: new Date(),
                },
            });
            await agentTickFinishIfDone(agentInstanceId);
            const still = await ModelAgentInstance.findById(id).select('status');
            if (still?.status === 'pending') {
                await ModelAgentInstance.findByIdAndUpdate(id, {
                    $set: {
                        status: 'success',
                        brainStep: 'done',
                        statusIsRunning: false,
                        summary: 'Stopped: budget max',
                        updatedAtUtc: new Date(),
                    },
                });
            }
            return;
        }

        if (await agentTickFinishIfDone(agentInstanceId)) {
            await ModelAgentInstance.findByIdAndUpdate(id, {
                $set: { brainStep: 'done', updatedAtUtc: new Date() },
            });
            return;
        }

        await runBrainTick(agentInstanceId);

        if (await agentTickFinishIfDone(agentInstanceId)) {
            await ModelAgentInstance.findByIdAndUpdate(id, {
                $set: { brainStep: 'done', updatedAtUtc: new Date() },
            });
            return;
        }

        await agentTickRelease(agentInstanceId);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'shell_consent_required') {
            return;
        }
        await agentTickFail(agentInstanceId, err);
    }
};

export default agentProcessTick;
