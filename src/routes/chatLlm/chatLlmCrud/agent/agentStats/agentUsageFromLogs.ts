/**
 * Per-instance usage is the sum of this instance's own LLM calls
 * (`past !== true`). Copied history from a previous run is ignored.
 */
import mongoose from 'mongoose';

import { ModelAgentLog } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentLog.schema';

export type AgentUsageTotals = {
    prompt: number;
    completion: number;
    reasoning: number;
    total: number;
    costInUsd: number;
    maxPromptPerQuery: number;
    maxCompletionPerQuery: number;
    llmRequestCount: number;
};

export const emptyAgentUsageTotals = (): AgentUsageTotals => ({
    prompt: 0,
    completion: 0,
    reasoning: 0,
    total: 0,
    costInUsd: 0,
    maxPromptPerQuery: 0,
    maxCompletionPerQuery: 0,
    llmRequestCount: 0,
});

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

const num = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

const usageFromLog = (log: { payload?: unknown; raw?: unknown }): AgentUsageTotals => {
    const payload = asRecord(log.payload);
    const raw = asRecord(log.raw);
    const usage = {
        ...asRecord(raw.usageStats),
        ...asRecord(payload.usage),
        ...asRecord(payload.usageStats),
    };
    const prompt = num(usage.promptTokens);
    const completion = num(usage.completionTokens);
    const reasoning = num(usage.reasoningTokens);
    const total = num(usage.totalTokens) || prompt + completion + reasoning;
    return {
        prompt,
        completion,
        reasoning,
        total,
        costInUsd: num(usage.costInUsd),
        maxPromptPerQuery: prompt,
        maxCompletionPerQuery: completion,
        llmRequestCount: 1,
    };
};

const addUsage = (acc: AgentUsageTotals, next: AgentUsageTotals): AgentUsageTotals => ({
    prompt: acc.prompt + next.prompt,
    completion: acc.completion + next.completion,
    reasoning: acc.reasoning + next.reasoning,
    total: acc.total + next.total,
    costInUsd: acc.costInUsd + next.costInUsd,
    maxPromptPerQuery: Math.max(acc.maxPromptPerQuery, next.maxPromptPerQuery),
    maxCompletionPerQuery: Math.max(acc.maxCompletionPerQuery, next.maxCompletionPerQuery),
    llmRequestCount: acc.llmRequestCount + next.llmRequestCount,
});

export const calculateAgentInstanceUsage = async (
    agentInstanceId: mongoose.Types.ObjectId | string
): Promise<AgentUsageTotals> => {
    const logs = await ModelAgentLog.find({
        agentInstanceId,
        past: { $ne: true },
        action: 'llm_call_end',
    })
        .select('payload raw')
        .lean();

    return logs.reduce((acc, log) => addUsage(acc, usageFromLog(log)), emptyAgentUsageTotals());
};

export const calculateAgentThreadUsage = async (
    threadId: mongoose.Types.ObjectId | string
): Promise<AgentUsageTotals> => {
    const logs = await ModelAgentLog.find({
        threadId,
        past: { $ne: true },
        action: 'llm_call_end',
    })
        .select('payload raw')
        .lean();

    return logs.reduce((acc, log) => addUsage(acc, usageFromLog(log)), emptyAgentUsageTotals());
};

export const calculateAgentInstanceUsageMap = async (
    agentInstanceIds: Array<mongoose.Types.ObjectId | string>
): Promise<Map<string, AgentUsageTotals>> => {
    const map = new Map<string, AgentUsageTotals>();
    if (agentInstanceIds.length === 0) {
        return map;
    }
    const logs = await ModelAgentLog.find({
        agentInstanceId: { $in: agentInstanceIds },
        past: { $ne: true },
        action: 'llm_call_end',
    })
        .select('agentInstanceId payload raw')
        .lean();

    for (const log of logs) {
        const key = String(log.agentInstanceId);
        const current = map.get(key) || emptyAgentUsageTotals();
        map.set(key, addUsage(current, usageFromLog(log)));
    }
    return map;
};
