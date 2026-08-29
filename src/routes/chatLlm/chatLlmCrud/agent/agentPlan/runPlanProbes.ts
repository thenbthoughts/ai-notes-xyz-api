import mongoose from 'mongoose';

import { ModelAgentGoal } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentMemory } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentUpdate } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { IAgentInstance } from '../../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentInstance.types';
import { IAgentGoal } from '../../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentGoal.types';
import { getLlmConfig } from '../../chatUtils/chatLlmGetLlmConfig';
import { defaultAgentToolRegistry, writeUpdate } from '../agentWork/agentToolRegistry';
import writeAgentLog, { type AgentLogContext } from '../agentUtils/agentWriteLog';
import type { PlanProbeAction } from './decidePlanStep';

export const runPlanProbes = async (params: {
    agent: IAgentInstance;
    logCtx: AgentLogContext;
    probes: PlanProbeAction[];
    fallbackGoal: IAgentGoal | null;
}): Promise<string[]> => {
    const { agent, logCtx, probes, fallbackGoal } = params;
    const id = agent._id as mongoose.Types.ObjectId;
    const tickNumber = agent.tickCount || 0;
    const summaries: string[] = [];

    const llmConfig = await getLlmConfig({ threadId: agent.threadId });
    const memories = await ModelAgentMemory.find({ agentInstanceId: id })
        .sort({ createdAtUtc: -1 })
        .limit(25);
    const recentUpdates = await ModelAgentUpdate.find({ agentInstanceId: id })
        .sort({ createdAtUtc: -1 })
        .limit(12);

    let currentGoal = fallbackGoal;
    if (!currentGoal) {
        currentGoal = await ModelAgentGoal.findOne({
            agentInstanceId: id,
            parentGoalId: null,
        }).sort({ orderIndex: 1 });
    }
    if (!currentGoal) {
        return summaries;
    }

    for (const probe of probes) {
        const tool = defaultAgentToolRegistry.getTool(probe.action);
        if (!tool) {
            summaries.push(`[skip] unknown probe action: ${probe.action}`);
            continue;
        }

        await writeUpdate({
            agentInstanceId: id,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'plan_probe',
            message: `Plan probe: ${probe.action}${probe.reason ? ` — ${probe.reason}` : ''}`,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
            payload: { probe },
        });

        try {
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
                    logCtx: {
                        ...logCtx,
                        goalId: currentGoal._id as mongoose.Types.ObjectId,
                    },
                },
                {
                    action: probe.action,
                    query: probe.query,
                    memoryKey: probe.memoryKey || `plan_note_${tickNumber}`,
                    memoryContent: probe.memoryContent,
                    memoryType: 'observation',
                    reason: probe.reason || 'plan probe',
                }
            );
            const line = `[${probe.action}] ${result.success ? 'ok' : 'fail'}: ${result.resultSummary}`.slice(
                0,
                2000
            );
            summaries.push(line);
            await writeAgentLog({
                ...logCtx,
                action: 'plan_probe',
                message: line,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                payload: {
                    action: probe.action,
                    success: result.success,
                    summary: result.resultSummary.slice(0, 1500),
                },
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            summaries.push(`[${probe.action}] error: ${msg}`.slice(0, 1000));
        }
    }

    return summaries;
};

/** Append probe results into durable plan_context memory. */
export const appendPlanContextMemory = async (params: {
    agent: IAgentInstance;
    tickNumber: number;
    contextNotes: string;
    probeSummaries: string[];
}): Promise<string> => {
    const { agent, tickNumber, contextNotes, probeSummaries } = params;
    const id = agent._id as mongoose.Types.ObjectId;
    const now = new Date();

    const existing = await ModelAgentMemory.findOne({
        agentInstanceId: id,
        key: 'plan_context',
    });
    const prev = existing?.content || '';
    const block = [
        `--- plan tick ${tickNumber} ---`,
        contextNotes ? `Notes: ${contextNotes}` : '',
        ...probeSummaries,
    ]
        .filter(Boolean)
        .join('\n');
    const next = `${prev}${prev ? '\n\n' : ''}${block}`.slice(-12000);

    await ModelAgentMemory.findOneAndUpdate(
        { agentInstanceId: id, key: 'plan_context' },
        {
            $set: {
                userId: agent.userId,
                threadId: agent.threadId,
                content: next,
                memoryType: 'plan',
                updatedAtUtc: now,
            },
            $setOnInsert: { createdAtUtc: now },
        },
        { upsert: true }
    );

    const countMem = await ModelAgentMemory.findOne({
        agentInstanceId: id,
        key: 'plan_probe_count',
    });
    const prevCount = Number(countMem?.content || '0') || 0;
    const added = probeSummaries.length;
    await ModelAgentMemory.findOneAndUpdate(
        { agentInstanceId: id, key: 'plan_probe_count' },
        {
            $set: {
                userId: agent.userId,
                threadId: agent.threadId,
                content: String(prevCount + added),
                memoryType: 'plan',
                updatedAtUtc: now,
            },
            $setOnInsert: { createdAtUtc: now },
        },
        { upsert: true }
    );

    return next;
};
