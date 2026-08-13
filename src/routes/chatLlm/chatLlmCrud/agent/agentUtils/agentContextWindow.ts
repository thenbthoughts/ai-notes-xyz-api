/**
 * Sliding context window for agent LLM prompts.
 *
 * Pass the last N raw actions (chat, tool calls, plan/verify, …) plus the last
 * M rolling summaries (each covering K older actions) and one global summary
 * of everything older than that.
 *
 * Workspace listings / working-directory paths are NOT injected — the agent
 * must call list_workspace_files to search.
 */
import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentMemory } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentUpdate } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelAgentInstance } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { getLlmConfig } from '../../chatUtils/chatLlmGetLlmConfig';
import { fetchLlmUnifiedLogged, type AgentLogContext } from './agentWriteLog';
import { loadAgentPersonalContextSections } from './agentPersonalContext';
import type { Message } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';

/** How many recent raw actions (chat, tool call, plan, …) to pass to the LLM. */
export const AGENT_CONTEXT_ACTION_LIMIT = 100;
export const AGENT_CONTEXT_ACTION_LIMIT_MIN = 1;
export const AGENT_CONTEXT_ACTION_LIMIT_MAX = 500;

/** How many rolling summaries to pass (oldest of these is folded into the global summary). */
export const AGENT_CONTEXT_SUMMARY_COUNT = 10;
export const AGENT_CONTEXT_SUMMARY_COUNT_MIN = 1;
export const AGENT_CONTEXT_SUMMARY_COUNT_MAX = 50;

/** How many actions are compacted into each new rolling summary. */
export const AGENT_CONTEXT_MESSAGES_PER_SUMMARY = 10;
export const AGENT_CONTEXT_MESSAGES_PER_SUMMARY_MIN = 1;
export const AGENT_CONTEXT_MESSAGES_PER_SUMMARY_MAX = 50;

export type AgentContextWindowLimits = {
    actionLimit: number;
    summaryCount: number;
    messagesPerSummary: number;
};

const clampInt = (n: unknown, min: number, max: number, fallback: number): number => {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
};

export const normalizeAgentContextWindowLimits = (
    partial?: Partial<AgentContextWindowLimits> | null
): AgentContextWindowLimits => ({
    actionLimit: clampInt(
        partial?.actionLimit,
        AGENT_CONTEXT_ACTION_LIMIT_MIN,
        AGENT_CONTEXT_ACTION_LIMIT_MAX,
        AGENT_CONTEXT_ACTION_LIMIT
    ),
    summaryCount: clampInt(
        partial?.summaryCount,
        AGENT_CONTEXT_SUMMARY_COUNT_MIN,
        AGENT_CONTEXT_SUMMARY_COUNT_MAX,
        AGENT_CONTEXT_SUMMARY_COUNT
    ),
    messagesPerSummary: clampInt(
        partial?.messagesPerSummary,
        AGENT_CONTEXT_MESSAGES_PER_SUMMARY_MIN,
        AGENT_CONTEXT_MESSAGES_PER_SUMMARY_MAX,
        AGENT_CONTEXT_MESSAGES_PER_SUMMARY
    ),
});

export const contextWindowLimitsFromDoc = (doc?: {
    contextActionLimit?: number;
    contextSummaryCount?: number;
    contextMessagesPerSummary?: number;
    agentContextActionLimit?: number;
    agentContextSummaryCount?: number;
    agentContextMessagesPerSummary?: number;
} | null): AgentContextWindowLimits =>
    normalizeAgentContextWindowLimits({
        actionLimit: doc?.contextActionLimit ?? doc?.agentContextActionLimit,
        summaryCount: doc?.contextSummaryCount ?? doc?.agentContextSummaryCount,
        messagesPerSummary: doc?.contextMessagesPerSummary ?? doc?.agentContextMessagesPerSummary,
    });

/**
 * Soft cap on estimated tokens for the packed context (actions + summaries).
 * When exceeded, older raw actions are summarized even if still under ACTION_LIMIT.
 */
export const AGENT_CONTEXT_TOKEN_SOFT_LIMIT = 20_000;

/** Max characters kept per action body in the raw window. */
export const AGENT_CONTEXT_ACTION_BODY_CHARS = 600;

const MEMORY_KEY_GLOBAL = 'context_global_summary';
const MEMORY_KEY_SUMMARIES = 'context_summaries';
const MEMORY_KEY_CURSOR = 'context_summarized_through_utc';
const MEMORY_KEY_MSG_GLOBAL = 'context_message_global_summary';
const MEMORY_KEY_MSG_SUMMARIES = 'context_message_summaries';
const MEMORY_KEY_MSG_CURSOR = 'context_message_summarized_through_utc';

const SKIP_UPDATE_TYPES = new Set(['tick', 'status']);

export type AgentContextAction = {
    kind: string;
    at: Date;
    title: string;
    body: string;
};

export type AgentContextSummary = {
    text: string;
    actionCount: number;
    fromUtc: string;
    toUtc: string;
};

export type AgentChatWindow = {
    /** Last N raw thread turns (N = Actions to pass). */
    messages: Message[];
    /** One summary of chat older than the rolling message summaries. */
    globalSummary: string;
    /** Last M rolling message summaries (M = Summaries to pass). */
    summaries: AgentContextSummary[];
};

export type AgentContextPack = {
    globalSummary: string;
    summaries: AgentContextSummary[];
    actions: AgentContextAction[];
    /** Last N thread chat messages (N = defined context action limit). */
    chatMessages: Message[];
    chatWindow: AgentChatWindow;
    formatted: string;
    estimatedTokens: number;
};

const CONTEXT_CHAT_BODY_CHARS = 2000;
const SKIP_CHAT_CONTENT = /^(AI generating in progress)/i;

const chatRowToText = (row: {
    type?: string;
    content?: string;
    fileContentText?: string;
    fileContentAi?: string;
}): string => {
    if (row.type === 'image' && row.fileContentAi) {
        return `Image description: ${String(row.fileContentAi)}`;
    }
    if (row.type === 'document' && row.fileContentText) {
        return `Document extracted text: ${String(row.fileContentText)}`;
    }
    return String(row.content || '').trim();
};

const isChatWindow = (value: unknown): value is AgentChatWindow =>
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray((value as AgentChatWindow).messages);

export const formatMessageSummaryPreamble = (window?: {
    globalSummary?: string;
    summaries?: AgentContextSummary[];
}): string => {
    if (!window) return '';
    const parts: string[] = [];
    if (window.globalSummary?.trim()) {
        parts.push(`GLOBAL MESSAGE SUMMARY:\n${window.globalSummary.trim()}`);
    }
    if (window.summaries?.length) {
        const lines = window.summaries.map((s, i) => {
            const span = s.fromUtc && s.toUtc ? ` (${s.fromUtc} → ${s.toUtc}, ${s.actionCount} messages)` : '';
            return `[${i + 1}]${span} ${s.text}`;
        });
        parts.push(`MESSAGE SUMMARIES (last ${window.summaries.length}):\n${lines.join('\n')}`);
    }
    return parts.join('\n\n');
};

export const formatContextChatTranscript = (
    messages: Message[],
    window?: Pick<AgentChatWindow, 'globalSummary' | 'summaries'>
): string => {
    const preamble = formatMessageSummaryPreamble(window);
    const turns = messages
        .map((m) => {
            const text = typeof m.content === 'string' ? m.content : '';
            const who = m.role === 'assistant' ? 'Assistant' : 'User';
            return `${who}: ${text}`;
        })
        .join('\n\n');
    return [preamble, turns].filter(Boolean).join('\n\n');
};

export const withContextChatMessages = (
    system: Message,
    context: Message[] | AgentChatWindow | undefined,
    user: Message
): Message[] => {
    const window = isChatWindow(context)
        ? context
        : { messages: context || [], globalSummary: '', summaries: [] };
    const history = window.messages;
    const preamble = formatMessageSummaryPreamble(window);
    const systemContent = typeof system.content === 'string' ? system.content : '';
    const systemWithSummary: Message = preamble
        ? {
              ...system,
              content: `${systemContent}\n\nOlder thread messages beyond the raw window are compressed here (same limits as Actions to pass / Summaries to pass / Messages per summary).\n\n${preamble}`,
          }
        : system;
    const userText = typeof user.content === 'string' ? user.content.trim() : '';
    const last = history[history.length - 1];
    const lastText = last && typeof last.content === 'string' ? last.content.trim() : '';
    const skipDuplicateUser = Boolean(last && last.role === 'user' && userText && lastText === userText);
    return [systemWithSummary, ...history, ...(skipDuplicateUser ? [] : [user])];
};

const estimateTokens = (text: string): number => Math.ceil((text || '').length / 4);

const clip = (text: string, max: number): string => {
    const s = (text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, Math.max(0, max - 1))}…`;
};

const parseSummaries = (raw: string | undefined): AgentContextSummary[] => {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((x) => x && typeof x === 'object' && typeof (x as AgentContextSummary).text === 'string')
            .map((x) => {
                const s = x as AgentContextSummary;
                return {
                    text: String(s.text || '').slice(0, 2000),
                    actionCount: Number(s.actionCount) || 0,
                    fromUtc: String(s.fromUtc || ''),
                    toUtc: String(s.toUtc || ''),
                };
            });
    } catch {
        return [];
    }
};

const formatActionLine = (action: AgentContextAction, bodyChars = AGENT_CONTEXT_ACTION_BODY_CHARS): string => {
    const body = clip(action.body, bodyChars);
    return body
        ? `- [${action.kind}] ${clip(action.title, 160)} — ${body}`
        : `- [${action.kind}] ${clip(action.title, 200)}`;
};

export const formatAgentContextPack = (pack: {
    globalSummary: string;
    summaries: AgentContextSummary[];
    actions: AgentContextAction[];
    personalProfile?: string;
    userMemories?: string;
    attachedContext?: string;
    messageGlobalSummary?: string;
    messageSummaries?: AgentContextSummary[];
}): string => {
    const parts: string[] = [
        'Workspace files are NOT listed here. Use list_workspace_files to search.',
    ];
    if (pack.personalProfile?.trim()) {
        parts.push(`PERSONAL CONTEXT:\n${pack.personalProfile.trim()}`);
    }
    if (pack.userMemories?.trim()) {
        parts.push(`USER MEMORIES:\n${pack.userMemories.trim()}`);
    }
    if (pack.attachedContext?.trim()) {
        parts.push(
            `ATTACHED CONTEXT (notes/tasks/life events/memo/info vault pinned to this thread):\n${pack.attachedContext.trim()}`
        );
    }
    if (pack.messageGlobalSummary?.trim() || pack.messageSummaries?.length) {
        const msgPreamble = formatMessageSummaryPreamble({
            globalSummary: pack.messageGlobalSummary,
            summaries: pack.messageSummaries,
        });
        if (msgPreamble) parts.push(msgPreamble);
    }
    if (pack.globalSummary.trim()) {
        parts.push(`GLOBAL SUMMARY:\n${pack.globalSummary.trim()}`);
    }
    if (pack.summaries.length) {
        const lines = pack.summaries.map((s, i) => {
            const span = s.fromUtc && s.toUtc ? ` (${s.fromUtc} → ${s.toUtc}, ${s.actionCount} actions)` : '';
            return `[${i + 1}]${span} ${s.text}`;
        });
        parts.push(`RECENT SUMMARIES (last ${pack.summaries.length}):\n${lines.join('\n')}`);
    }
    if (pack.actions.length) {
        parts.push(
            `RECENT ACTIONS (last ${pack.actions.length}):\n${pack.actions.map((a) => formatActionLine(a)).join('\n')}`
        );
    }
    return parts.join('\n\n');
};

const collectActions = async (params: {
    agentInstanceId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    fetchLimit: number;
}): Promise<AgentContextAction[]> => {
    const { agentInstanceId, threadId, fetchLimit } = params;
    const [chatDocs, updates] = await Promise.all([
        ModelChatLlm.find({ threadId }).sort({ createdAtUtc: -1 }).limit(fetchLimit).lean(),
        ModelAgentUpdate.find({ agentInstanceId }).sort({ createdAtUtc: -1 }).limit(fetchLimit).lean(),
    ]);

    const actions: AgentContextAction[] = [];

    for (const m of chatDocs) {
        const content = String(m.content || '').trim();
        if (!content) continue;
        if (/^AI generating in progress/i.test(content)) continue;
        actions.push({
            kind: m.isAi ? 'chat_assistant' : 'chat_user',
            at: m.createdAtUtc || new Date(0),
            title: m.isAi ? 'assistant' : 'user',
            body: content.slice(0, 2000),
        });
    }

    for (const u of updates) {
        const updateType = String(u.updateType || 'update');
        if (SKIP_UPDATE_TYPES.has(updateType)) continue;
        const payload = (u.payload || {}) as Record<string, unknown>;
        const extra =
            typeof payload.toolResultSummary === 'string'
                ? payload.toolResultSummary
                : typeof payload.action === 'string'
                  ? String(payload.action)
                  : '';
        const message = String(u.message || '').trim();
        if (!message && !extra) continue;
        actions.push({
            kind: updateType,
            at: u.createdAtUtc || new Date(0),
            title: message || updateType,
            body: extra && extra !== message ? extra.slice(0, 2000) : '',
        });
    }

    actions.sort((a, b) => a.at.getTime() - b.at.getTime());
    return actions;
};

const extractiveSummary = (actions: AgentContextAction[]): string =>
    actions
        .map((a) => `${a.kind}: ${clip(a.title, 80)}${a.body ? ` — ${clip(a.body, 120)}` : ''}`)
        .join('; ')
        .slice(0, 800);

const summarizeActionBatch = async (params: {
    logCtx: AgentLogContext;
    actions: AgentContextAction[];
    purpose: string;
    instruction: string;
}): Promise<string> => {
    const { logCtx, actions, purpose, instruction } = params;
    const fallback = extractiveSummary(actions);
    if (!actions.length) return '';

    const llmConfig = await getLlmConfig({ threadId: logCtx.threadId });
    if (!llmConfig) return fallback;

    try {
        const llmResult = await fetchLlmUnifiedLogged({
            logCtx,
            purpose,
            params: {
                provider: llmConfig.provider,
                apiKey: llmConfig.apiKey,
                apiEndpoint: llmConfig.apiEndpoint,
                model: llmConfig.model,
                messages: [
                    {
                        role: 'system',
                        content:
                            'Summarize agent activity. Keep file names, tool outcomes, decisions, and errors. Plain text only. 3–8 sentences.',
                    },
                    {
                        role: 'user',
                        content: `${instruction}\n\n${actions.map((a) => formatActionLine(a, 400)).join('\n')}`.slice(
                            0,
                            12_000
                        ),
                    },
                ],
                temperature: 0.2,
                maxTokens: 400,
                headersExtra: llmConfig.customHeaders,
            },
        });
        const text = String(llmResult.content || '').trim();
        return text ? text.slice(0, 1600) : fallback;
    } catch {
        return fallback;
    }
};

const upsertMemory = async (params: {
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    key: string;
    content: string;
}): Promise<void> => {
    const now = new Date();
    await ModelAgentMemory.findOneAndUpdate(
        { agentInstanceId: params.agentInstanceId, key: params.key },
        {
            $set: {
                userId: params.userId,
                threadId: params.threadId,
                content: params.content,
                memoryType: 'observation',
                past: false,
                updatedAtUtc: now,
            },
            $setOnInsert: { createdAtUtc: now },
        },
        { upsert: true }
    );
};

const loadWindowState = async (
    agentInstanceId: mongoose.Types.ObjectId
): Promise<{
    globalSummary: string;
    summaries: AgentContextSummary[];
    cursorUtc: Date | null;
}> => {
    const rows = await ModelAgentMemory.find({
        agentInstanceId,
        key: { $in: [MEMORY_KEY_GLOBAL, MEMORY_KEY_SUMMARIES, MEMORY_KEY_CURSOR] },
    }).lean();
    const byKey = new Map(rows.map((r) => [r.key, r.content || '']));
    const cursorRaw = byKey.get(MEMORY_KEY_CURSOR) || '';
    const cursorMs = Date.parse(cursorRaw);
    return {
        globalSummary: byKey.get(MEMORY_KEY_GLOBAL) || '',
        summaries: parseSummaries(byKey.get(MEMORY_KEY_SUMMARIES)),
        cursorUtc: Number.isFinite(cursorMs) ? new Date(cursorMs) : null,
    };
};

const persistWindowState = async (params: {
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    globalSummary: string;
    summaries: AgentContextSummary[];
    cursorUtc: Date | null;
}): Promise<void> => {
    const { agentInstanceId, userId, threadId } = params;
    await Promise.all([
        upsertMemory({
            agentInstanceId,
            userId,
            threadId,
            key: MEMORY_KEY_GLOBAL,
            content: params.globalSummary.slice(0, 4000),
        }),
        upsertMemory({
            agentInstanceId,
            userId,
            threadId,
            key: MEMORY_KEY_SUMMARIES,
            content: JSON.stringify(params.summaries),
        }),
        upsertMemory({
            agentInstanceId,
            userId,
            threadId,
            key: MEMORY_KEY_CURSOR,
            content: params.cursorUtc ? params.cursorUtc.toISOString() : '',
        }),
    ]);
};

const foldOldestSummariesIntoGlobal = async (params: {
    logCtx: AgentLogContext;
    globalSummary: string;
    summaries: AgentContextSummary[];
    summaryCount: number;
}): Promise<{ globalSummary: string; summaries: AgentContextSummary[] }> => {
    let { globalSummary, summaries } = params;
    const keep = Math.max(1, params.summaryCount);
    while (summaries.length > keep) {
        const overflow = summaries.slice(0, summaries.length - keep);
        summaries = summaries.slice(summaries.length - keep);
        const folded = await summarizeActionBatch({
            logCtx: params.logCtx,
            purpose: 'agent_context_global_summary',
            instruction:
                'Merge the existing global summary with these older rolling summaries into ONE updated global summary.',
            actions: [
                ...(globalSummary
                    ? [
                          {
                              kind: 'global_summary',
                              at: new Date(0),
                              title: 'existing global summary',
                              body: globalSummary,
                          },
                      ]
                    : []),
                ...overflow.map((s) => ({
                    kind: 'rolling_summary',
                    at: s.fromUtc ? new Date(s.fromUtc) : new Date(0),
                    title: `${s.actionCount} actions`,
                    body: s.text,
                })),
            ],
        });
        globalSummary = folded || globalSummary;
    }
    return { globalSummary, summaries };
};

const loadMessageWindowState = async (
    agentInstanceId?: mongoose.Types.ObjectId
): Promise<{
    globalSummary: string;
    summaries: AgentContextSummary[];
    cursorUtc: Date | null;
}> => {
    if (!agentInstanceId) {
        return { globalSummary: '', summaries: [], cursorUtc: null };
    }
    const rows = await ModelAgentMemory.find({
        agentInstanceId,
        key: { $in: [MEMORY_KEY_MSG_GLOBAL, MEMORY_KEY_MSG_SUMMARIES, MEMORY_KEY_MSG_CURSOR] },
    }).lean();
    const byKey = new Map(rows.map((r) => [r.key, r.content || '']));
    const cursorMs = Date.parse(byKey.get(MEMORY_KEY_MSG_CURSOR) || '');
    return {
        globalSummary: byKey.get(MEMORY_KEY_MSG_GLOBAL) || '',
        summaries: parseSummaries(byKey.get(MEMORY_KEY_MSG_SUMMARIES)),
        cursorUtc: Number.isFinite(cursorMs) ? new Date(cursorMs) : null,
    };
};

const persistMessageWindowState = async (params: {
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    globalSummary: string;
    summaries: AgentContextSummary[];
    cursorUtc: Date | null;
}): Promise<void> => {
    await Promise.all([
        upsertMemory({
            agentInstanceId: params.agentInstanceId,
            userId: params.userId,
            threadId: params.threadId,
            key: MEMORY_KEY_MSG_GLOBAL,
            content: params.globalSummary.slice(0, 4000),
        }),
        upsertMemory({
            agentInstanceId: params.agentInstanceId,
            userId: params.userId,
            threadId: params.threadId,
            key: MEMORY_KEY_MSG_SUMMARIES,
            content: JSON.stringify(params.summaries),
        }),
        upsertMemory({
            agentInstanceId: params.agentInstanceId,
            userId: params.userId,
            threadId: params.threadId,
            key: MEMORY_KEY_MSG_CURSOR,
            content: params.cursorUtc ? params.cursorUtc.toISOString() : '',
        }),
    ]);
};

/**
 * Last N raw chat turns + last M rolling message summaries + one global
 * summary of everything older. Uses the same limits as Actions to pass /
 * Summaries to pass / Messages per summary.
 */
export const loadContextChatWindow = async (params: {
    threadId: mongoose.Types.ObjectId;
    actionLimit?: number;
    summaryCount?: number;
    messagesPerSummary?: number;
    agentInstanceId?: mongoose.Types.ObjectId;
    userId?: mongoose.Types.ObjectId;
    logCtx?: AgentLogContext;
}): Promise<AgentChatWindow> => {
    const stored = params.agentInstanceId
        ? await ModelAgentInstance.findById(params.agentInstanceId)
              .select('contextActionLimit contextSummaryCount contextMessagesPerSummary')
              .lean()
        : null;
    const limits = normalizeAgentContextWindowLimits({
        actionLimit: params.actionLimit ?? stored?.contextActionLimit,
        summaryCount: params.summaryCount ?? stored?.contextSummaryCount,
        messagesPerSummary: params.messagesPerSummary ?? stored?.contextMessagesPerSummary,
    });
    const actionLimit = limits.actionLimit;
    const summaryCount = limits.summaryCount;
    const messagesPerSummary = limits.messagesPerSummary;
    const fetchLimit = actionLimit + summaryCount * messagesPerSummary + messagesPerSummary * 4;

    const [docs, state] = await Promise.all([
        ModelChatLlm.find({ threadId: params.threadId })
            .sort({ createdAtUtc: -1 })
            .limit(fetchLimit)
            .select('type content isAi fileContentText fileContentAi createdAtUtc')
            .lean(),
        loadMessageWindowState(params.agentInstanceId),
    ]);

    const chatActions: AgentContextAction[] = [];
    for (const row of docs.slice().reverse()) {
        const text = chatRowToText(row);
        if (!text || SKIP_CHAT_CONTENT.test(text)) continue;
        chatActions.push({
            kind: row.isAi ? 'chat_assistant' : 'chat_user',
            at: row.createdAtUtc || new Date(0),
            title: row.isAi ? 'assistant' : 'user',
            body: text.slice(0, CONTEXT_CHAT_BODY_CHARS),
        });
    }

    let { globalSummary, summaries, cursorUtc } = state;
    const unsummarized = cursorUtc
        ? chatActions.filter((a) => a.at.getTime() > cursorUtc!.getTime())
        : chatActions;

    let raw = unsummarized;
    const overflow: AgentContextAction[] = [];
    while (raw.length > actionLimit && raw.length > messagesPerSummary) {
        const chunk = raw.slice(0, messagesPerSummary);
        overflow.push(...chunk);
        raw = raw.slice(messagesPerSummary);
    }

    if (overflow.length) {
        const logCtx = params.logCtx;
        for (let i = 0; i < overflow.length; i += messagesPerSummary) {
            const chunk = overflow.slice(i, i + messagesPerSummary);
            const text = logCtx
                ? await summarizeActionBatch({
                      logCtx,
                      purpose: 'agent_message_summary',
                      instruction: `Summarize these ${chunk.length} older chat messages. Keep user intent, decisions, and outcomes.`,
                      actions: chunk,
                  })
                : extractiveSummary(chunk);
            summaries.push({
                text,
                actionCount: chunk.length,
                fromUtc: chunk[0].at.toISOString(),
                toUtc: chunk[chunk.length - 1].at.toISOString(),
            });
        }
        cursorUtc = overflow[overflow.length - 1].at;
        if (logCtx) {
            const folded = await foldOldestSummariesIntoGlobal({
                logCtx,
                globalSummary,
                summaries,
                summaryCount,
            });
            globalSummary = folded.globalSummary;
            summaries = folded.summaries;
        } else if (summaries.length > summaryCount) {
            const extra = summaries.slice(0, summaries.length - summaryCount);
            summaries = summaries.slice(-summaryCount);
            const extraText = extra.map((s) => s.text).join(' ');
            globalSummary = clip(`${globalSummary} ${extraText}`.trim(), 4000);
        }
        if (params.agentInstanceId && params.userId) {
            await persistMessageWindowState({
                agentInstanceId: params.agentInstanceId,
                userId: params.userId,
                threadId: params.threadId,
                globalSummary,
                summaries,
                cursorUtc,
            });
        }
    }

    const keep = raw.slice(-actionLimit);
    const messages: Message[] = keep.map((a) => ({
        role: a.kind === 'chat_assistant' ? 'assistant' : 'user',
        content: a.body.slice(0, CONTEXT_CHAT_BODY_CHARS),
    }));

    return {
        messages,
        globalSummary,
        summaries: summaries.slice(-summaryCount),
    };
};

export const loadContextChatMessages = async (params: {
    threadId: mongoose.Types.ObjectId;
    actionLimit?: number;
    summaryCount?: number;
    messagesPerSummary?: number;
    agentInstanceId?: mongoose.Types.ObjectId;
    userId?: mongoose.Types.ObjectId;
    logCtx?: AgentLogContext;
}): Promise<Message[]> => {
    const window = await loadContextChatWindow(params);
    return window.messages;
};

/**
 * Compact overflow into rolling summaries + one global summary, then return
 * the pack to pass into planner / verify / synthesize / code-gen prompts.
 */
export const buildAgentContextPack = async (params: {
    logCtx: AgentLogContext;
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    actionLimit?: number;
    summaryCount?: number;
    messagesPerSummary?: number;
    tokenSoftLimit?: number;
}): Promise<AgentContextPack> => {
    const stored = await ModelAgentInstance.findById(params.agentInstanceId)
        .select('contextActionLimit contextSummaryCount contextMessagesPerSummary')
        .lean();
    const limits = normalizeAgentContextWindowLimits({
        actionLimit: params.actionLimit ?? stored?.contextActionLimit,
        summaryCount: params.summaryCount ?? stored?.contextSummaryCount,
        messagesPerSummary: params.messagesPerSummary ?? stored?.contextMessagesPerSummary,
    });
    const actionLimit = limits.actionLimit;
    const summaryCount = limits.summaryCount;
    const messagesPerSummary = limits.messagesPerSummary;
    const tokenSoftLimit = Math.max(1000, params.tokenSoftLimit ?? AGENT_CONTEXT_TOKEN_SOFT_LIMIT);
    const fetchLimit = actionLimit + summaryCount * messagesPerSummary + messagesPerSummary * 4;

    const [allActions, state, personal, chatWindow] = await Promise.all([
        collectActions({
            agentInstanceId: params.agentInstanceId,
            threadId: params.threadId,
            fetchLimit,
        }),
        loadWindowState(params.agentInstanceId),
        loadAgentPersonalContextSections({
            userId: params.userId,
            threadId: params.threadId,
        }),
        loadContextChatWindow({
            threadId: params.threadId,
            actionLimit,
            summaryCount,
            messagesPerSummary,
            agentInstanceId: params.agentInstanceId,
            userId: params.userId,
            logCtx: params.logCtx,
        }),
    ]);

    let { globalSummary, summaries, cursorUtc } = state;
    const unsummarized = cursorUtc
        ? allActions.filter((a) => a.at.getTime() > cursorUtc!.getTime())
        : allActions;

    const tokensOf = (actions: AgentContextAction[]): number =>
        estimateTokens(actions.map((a) => formatActionLine(a)).join('\n'));

    let raw = unsummarized;
    const overflow: AgentContextAction[] = [];

    const shouldCompact = (): boolean =>
        raw.length > actionLimit || tokensOf(raw) > tokenSoftLimit;

    while (shouldCompact() && raw.length > messagesPerSummary) {
        const chunk = raw.slice(0, messagesPerSummary);
        overflow.push(...chunk);
        raw = raw.slice(messagesPerSummary);
    }

    if (overflow.length) {
        for (let i = 0; i < overflow.length; i += messagesPerSummary) {
            const chunk = overflow.slice(i, i + messagesPerSummary);
            const text = await summarizeActionBatch({
                logCtx: params.logCtx,
                purpose: 'agent_context_summary',
                instruction: `Summarize these ${chunk.length} agent actions (chat, tool calls, results).`,
                actions: chunk,
            });
            summaries.push({
                text,
                actionCount: chunk.length,
                fromUtc: chunk[0].at.toISOString(),
                toUtc: chunk[chunk.length - 1].at.toISOString(),
            });
        }
        cursorUtc = overflow[overflow.length - 1].at;
        const folded = await foldOldestSummariesIntoGlobal({
            logCtx: params.logCtx,
            globalSummary,
            summaries,
            summaryCount,
        });
        globalSummary = folded.globalSummary;
        summaries = folded.summaries;
        await persistWindowState({
            agentInstanceId: params.agentInstanceId,
            userId: params.userId,
            threadId: params.threadId,
            globalSummary,
            summaries,
            cursorUtc,
        });
    }

    const actions = raw.slice(-actionLimit);
    const promptActions = actions.filter(
        (a) => a.kind !== 'chat_user' && a.kind !== 'chat_assistant'
    );
    const passSummaries = summaries.slice(-summaryCount);
    const formatted = formatAgentContextPack({
        globalSummary,
        summaries: passSummaries,
        actions: promptActions,
        personalProfile: personal.personalProfile,
        userMemories: personal.userMemories,
        attachedContext: personal.attachedContext,
        messageGlobalSummary: chatWindow.globalSummary,
        messageSummaries: chatWindow.summaries,
    });

    return {
        globalSummary,
        summaries: passSummaries,
        actions: promptActions,
        chatMessages: chatWindow.messages,
        chatWindow,
        formatted,
        estimatedTokens: estimateTokens(formatted),
    };
};

/** True when a memory row is context-window bookkeeping (do not dump again as "memory"). */
export const isAgentContextMemoryKey = (key: string): boolean =>
    key === MEMORY_KEY_GLOBAL ||
    key === MEMORY_KEY_SUMMARIES ||
    key === MEMORY_KEY_CURSOR ||
    key === MEMORY_KEY_MSG_GLOBAL ||
    key === MEMORY_KEY_MSG_SUMMARIES ||
    key === MEMORY_KEY_MSG_CURSOR ||
    /^context_summary_/i.test(key);
