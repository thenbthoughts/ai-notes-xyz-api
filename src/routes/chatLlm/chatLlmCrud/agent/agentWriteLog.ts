import mongoose from 'mongoose';

import { ModelAgentLog } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentLog.schema';
import type {
    AgentLogAction,
    AgentLogLevel,
} from '../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentLog.types';
import fetchLlmUnified, {
    type FetchLlmParams,
    type FetchLlmResult,
} from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';

export type WriteAgentLogArgs = {
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    action: AgentLogAction | string;
    /** Short UI title. Falls back to a truncated message. */
    title?: string;
    message: string;
    level?: AgentLogLevel;
    payload?: Record<string, unknown>;
    /** Unstructured dump (string, object, array, …). */
    raw?: unknown;
    goalId?: mongoose.Types.ObjectId | null;
    tickNumber?: number;
};

/** Shared context for shell / LLM logs tied to an agent run. */
export type AgentLogContext = {
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    goalId?: mongoose.Types.ObjectId | null;
    tickNumber?: number;
};

const shortTitle = (action: string, message: string, title?: string): string => {
    const t = (title || '').trim();
    if (t) {
        return t.slice(0, 160);
    }
    const m = (message || '').trim();
    if (m) {
        return m.slice(0, 120);
    }
    return action || 'log';
};

/**
 * Persist one agent activity log entry. Never throws — logging must not break the agent loop.
 */
const writeAgentLog = async (args: WriteAgentLogArgs): Promise<void> => {
    try {
        await ModelAgentLog.create({
            agentInstanceId: args.agentInstanceId,
            userId: args.userId,
            threadId: args.threadId,
            level: args.level || 'info',
            action: args.action || 'other',
            title: shortTitle(String(args.action || 'other'), args.message, args.title),
            message: (args.message || '').slice(0, 8000),
            payload: args.payload || {},
            raw: args.raw ?? null,
            goalId: args.goalId || null,
            tickNumber: args.tickNumber ?? 0,
            createdAtUtc: new Date(),
        });
    } catch (err) {
        console.error('writeAgentLog failed:', err);
    }
};

export const writeAgentLogFromContext = async (
    ctx: AgentLogContext | undefined | null,
    args: {
        action: AgentLogAction | string;
        title?: string;
        message: string;
        level?: AgentLogLevel;
        payload?: Record<string, unknown>;
        raw?: unknown;
    },
): Promise<void> => {
    if (!ctx) {
        return;
    }
    await writeAgentLog({
        agentInstanceId: ctx.agentInstanceId,
        userId: ctx.userId,
        threadId: ctx.threadId,
        goalId: ctx.goalId ?? null,
        tickNumber: ctx.tickNumber ?? 0,
        action: args.action,
        title: args.title,
        message: args.message,
        level: args.level,
        payload: args.payload,
        raw: args.raw,
    });
};

const messagesToRaw = (messages: FetchLlmParams['messages']): unknown => {
    try {
        return (messages || []).map((m) => {
            const content =
                typeof m.content === 'string'
                    ? m.content
                    : JSON.stringify(m.content);
            return {
                role: m.role,
                content: content.slice(0, 20_000),
            };
        });
    } catch {
        return messages;
    }
};

/**
 * LLM call with start / end / error agent logs (title + expandable raw detail).
 */
export const fetchLlmUnifiedLogged = async ({
    logCtx,
    purpose,
    params,
}: {
    logCtx: AgentLogContext;
    purpose: string;
    params: FetchLlmParams;
}): Promise<FetchLlmResult> => {
    const startedAt = Date.now();
    const purposeLabel = purpose.replace(/_/g, ' ');

    await writeAgentLog({
        ...logCtx,
        goalId: logCtx.goalId ?? null,
        tickNumber: logCtx.tickNumber ?? 0,
        action: 'llm_call_start',
        title: `LLM → ${purposeLabel}`,
        message: `Calling ${params.provider}/${params.model} for ${purpose}`,
        level: 'info',
        payload: {
            purpose,
            provider: params.provider,
            model: params.model,
            maxTokens: params.maxTokens ?? null,
            temperature: params.temperature ?? null,
            messageCount: Array.isArray(params.messages) ? params.messages.length : 0,
            apiEndpoint: params.apiEndpoint || '',
        },
        raw: {
            messages: messagesToRaw(params.messages),
            responseFormat: params.responseFormat || null,
        },
    });

    try {
        const result = await fetchLlmUnified(params);
        const durationMs = Date.now() - startedAt;
        await writeAgentLog({
            ...logCtx,
            goalId: logCtx.goalId ?? null,
            tickNumber: logCtx.tickNumber ?? 0,
            action: result.success ? 'llm_call_end' : 'llm_call_error',
            title: result.success
                ? `LLM ✓ ${purposeLabel} (${durationMs}ms)`
                : `LLM ✗ ${purposeLabel}`,
            message: result.success
                ? `${params.provider}/${params.model} returned ${result.usageStats?.totalTokens ?? 0} tokens in ${durationMs}ms`
                : `LLM failed: ${result.error || 'unknown'}`,
            level: result.success ? 'info' : 'error',
            payload: {
                purpose,
                provider: params.provider,
                model: params.model,
                durationMs,
                success: result.success,
                error: result.error || '',
                contentLength: String(result.content || '').length,
                usage: result.usageStats || {},
            },
            raw: {
                content: String(result.content || '').slice(0, 50_000),
                error: result.error || '',
                usageStats: result.usageStats || {},
                // Full provider response for deep debug (size-capped via JSON stringify below if needed)
                providerRaw: (() => {
                    try {
                        const s = JSON.stringify(result.raw);
                        if (!s) return null;
                        return s.length > 80_000 ? s.slice(0, 80_000) + '…[truncated]' : JSON.parse(s);
                    } catch {
                        return String(result.raw).slice(0, 20_000);
                    }
                })(),
            },
        });
        return result;
    } catch (err) {
        const durationMs = Date.now() - startedAt;
        const errMsg = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack || '' : '';
        await writeAgentLog({
            ...logCtx,
            goalId: logCtx.goalId ?? null,
            tickNumber: logCtx.tickNumber ?? 0,
            action: 'llm_call_error',
            title: `LLM ✗ ${purposeLabel}`,
            message: `LLM threw: ${errMsg}`,
            level: 'error',
            payload: {
                purpose,
                provider: params.provider,
                model: params.model,
                durationMs,
                error: errMsg,
            },
            raw: {
                error: errMsg,
                stack: errStack.slice(0, 20_000),
            },
        });
        throw err;
    }
};

export default writeAgentLog;
