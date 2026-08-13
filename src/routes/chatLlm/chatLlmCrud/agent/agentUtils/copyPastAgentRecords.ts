/**
 * When a new agent instance starts, copy the last N action records from the
 * previous instance on the same thread (tool calls, plan/verify, LLM logs, …)
 * and mark them `past: true` so they are context-only and never billed.
 */
import mongoose from 'mongoose';

import { ModelAgentInstance } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentLog } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentLog.schema';
import { ModelAgentUpdate } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelAgentMemory } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import {
    AGENT_CONTEXT_ACTION_LIMIT,
    AGENT_CONTEXT_ACTION_LIMIT_MAX,
    AGENT_CONTEXT_ACTION_LIMIT_MIN,
} from './agentContextWindow';

const SKIP_UPDATE_TYPES = new Set(['tick', 'status']);
const SKIP_COPY_MEMORY_KEYS = new Set(['user_request']);

const clampCopyLimit = (n: unknown): number => {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return AGENT_CONTEXT_ACTION_LIMIT;
    return Math.min(AGENT_CONTEXT_ACTION_LIMIT_MAX, Math.max(AGENT_CONTEXT_ACTION_LIMIT_MIN, v));
};

export const copyPastAgentRecords = async (params: {
    toInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    recordLimit?: number;
}): Promise<{ copiedLogs: number; copiedUpdates: number; copiedMemories: number }> => {
    const limit = clampCopyLimit(params.recordLimit);
    const previous = await ModelAgentInstance.findOne({
        threadId: params.threadId,
        userId: params.userId,
        _id: { $ne: params.toInstanceId },
    })
        .sort({ createdAtUtc: -1 })
        .select('_id')
        .lean();

    if (!previous) {
        return { copiedLogs: 0, copiedUpdates: 0, copiedMemories: 0 };
    }

    const fromInstanceId = previous._id as mongoose.Types.ObjectId;

    const [logs, updates, memories] = await Promise.all([
        ModelAgentLog.find({ agentInstanceId: fromInstanceId })
            .sort({ createdAtUtc: -1 })
            .limit(limit)
            .lean(),
        ModelAgentUpdate.find({
            agentInstanceId: fromInstanceId,
            updateType: { $nin: [...SKIP_UPDATE_TYPES] },
        })
            .sort({ createdAtUtc: -1 })
            .limit(limit)
            .lean(),
        ModelAgentMemory.find({
            agentInstanceId: fromInstanceId,
            key: { $nin: [...SKIP_COPY_MEMORY_KEYS] },
        })
            .sort({ createdAtUtc: -1 })
            .limit(limit)
            .lean(),
    ]);

    const logDocs = logs
        .slice()
        .reverse()
        .map((row) => ({
            agentInstanceId: params.toInstanceId,
            userId: params.userId,
            threadId: params.threadId,
            level: row.level || 'info',
            action: row.action || 'other',
            title: row.title || '',
            message: row.message || '',
            payload: row.payload || {},
            raw: row.raw ?? null,
            goalId: null,
            tickNumber: row.tickNumber || 0,
            past: true,
            createdAtUtc: row.createdAtUtc || new Date(),
        }));

    const updateDocs = updates
        .slice()
        .reverse()
        .map((row) => ({
            agentInstanceId: params.toInstanceId,
            userId: params.userId,
            threadId: params.threadId,
            updateType: row.updateType || 'message',
            message: row.message || '',
            payload: row.payload || {},
            goalId: null,
            tickNumber: row.tickNumber || 0,
            past: true,
            createdAtUtc: row.createdAtUtc || new Date(),
        }));

    const memoryDocs = memories
        .slice()
        .reverse()
        .filter((row) => {
            const key = String(row.key || '');
            if (!key || SKIP_COPY_MEMORY_KEYS.has(key)) return false;
            return true;
        })
        .map((row) => ({
            agentInstanceId: params.toInstanceId,
            userId: params.userId,
            threadId: params.threadId,
            key: row.key || '',
            content: row.content || '',
            memoryType: row.memoryType || 'other',
            past: true,
            createdAtUtc: row.createdAtUtc || new Date(),
            updatedAtUtc: row.updatedAtUtc || row.createdAtUtc || new Date(),
        }));

    if (logDocs.length > 0) {
        await ModelAgentLog.insertMany(logDocs, { ordered: false });
    }
    if (updateDocs.length > 0) {
        await ModelAgentUpdate.insertMany(updateDocs, { ordered: false });
    }
    if (memoryDocs.length > 0) {
        await ModelAgentMemory.insertMany(memoryDocs, { ordered: false });
    }

    return {
        copiedLogs: logDocs.length,
        copiedUpdates: updateDocs.length,
        copiedMemories: memoryDocs.length,
    };
};
