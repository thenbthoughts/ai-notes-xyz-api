import mongoose from 'mongoose';

import { ModelAgentGoal } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentMemory } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { IAgentInstance } from '../../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentInstance.types';
import { expandAndPersistAgentGoal, loadGoalExpansion } from './agentGoalExpand';
import writeAgentLog, { type AgentLogContext } from '../agentUtils/agentWriteLog';
import { writeUpdate } from '../agentWork/agentToolRegistry';

/**
 * Expand top-level goals (and depth-1 children) using gathered plan_context.
 */
export const expandGoalsInPlanStage = async (params: {
    agent: IAgentInstance;
    logCtx: AgentLogContext;
    userRequest: string;
    planContext: string;
    isReplan: boolean;
}): Promise<Array<{ title: string; outputFormat: string; subGoals: number }>> => {
    const { agent, logCtx, userRequest, planContext, isReplan } = params;
    const id = agent._id as mongoose.Types.ObjectId;
    const tickNumber = agent.tickCount || 0;

    const tops = await ModelAgentGoal.find({
        agentInstanceId: id,
        parentGoalId: null,
        status: { $in: ['pending', 'in_progress'] },
    }).sort({ orderIndex: 1 });

    const expansionSummaries: Array<{ title: string; outputFormat: string; subGoals: number }> =
        [];

    for (const g of tops) {
        const existing = await loadGoalExpansion(g._id as mongoose.Types.ObjectId);
        if (existing && !isReplan) {
            const children = await ModelAgentGoal.find({
                agentInstanceId: id,
                parentGoalId: g._id,
            });
            for (const sg of children) {
                const childExp = await loadGoalExpansion(sg._id as mongoose.Types.ObjectId);
                if (!childExp) {
                    await expandAndPersistAgentGoal({
                        logCtx,
                        goal: sg,
                        userRequest,
                        planContext,
                        allowSubGoals: false,
                    });
                }
            }
            expansionSummaries.push({
                title: g.title,
                outputFormat: existing.outputFormat,
                subGoals: children.length,
            });
            continue;
        }

        const { expansion, subGoals } = await expandAndPersistAgentGoal({
            logCtx,
            goal: g,
            userRequest,
            planContext,
            allowSubGoals: true,
            replacePendingChildren: isReplan,
        });
        for (const sg of subGoals) {
            await expandAndPersistAgentGoal({
                logCtx,
                goal: sg,
                userRequest,
                planContext,
                allowSubGoals: false,
            });
        }
        expansionSummaries.push({
            title: g.title,
            outputFormat: expansion.outputFormat,
            subGoals: subGoals.length,
        });
    }

    await writeUpdate({
        agentInstanceId: id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'status',
        message: `Plan expanded → ${expansionSummaries.length} top goal(s)`,
        tickNumber,
        payload: {
            brainStep: 'plan',
            expansions: expansionSummaries,
            hasPlanContext: Boolean(planContext),
        },
    });
    await writeAgentLog({
        ...logCtx,
        action: 'status_next_plan_done',
        message: `Plan expand complete. Expansions: ${JSON.stringify(expansionSummaries).slice(0, 1500)}`,
        payload: { expansions: expansionSummaries },
    });

    return expansionSummaries;
};

export const loadPlanContextBundle = async (
    agentInstanceId: mongoose.Types.ObjectId
): Promise<{ planContext: string; probeCount: number; userRequest: string }> => {
    const [ctx, count, req] = await Promise.all([
        ModelAgentMemory.findOne({ agentInstanceId, key: 'plan_context' }),
        ModelAgentMemory.findOne({ agentInstanceId, key: 'plan_probe_count' }),
        ModelAgentMemory.findOne({ agentInstanceId, key: 'user_request' }),
    ]);
    return {
        planContext: ctx?.content || '',
        probeCount: Number(count?.content || '0') || 0,
        userRequest: req?.content || '',
    };
};
