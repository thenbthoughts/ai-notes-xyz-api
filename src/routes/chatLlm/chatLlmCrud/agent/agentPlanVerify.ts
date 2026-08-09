import { Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { fetchLlmUnifiedStream } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../chatLlmGetLlmConfig';
import writeAgentLog, { fetchLlmUnifiedLogged, AgentLogContext } from './agentWriteLog';
import { AGENT_SHELL_ENV_BLURB } from './agentShellEnvironmentContext';
import type { AgentSkillCatalogItem } from './agentSkillsLib';
import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import mongoose from 'mongoose';

type LlmConfig = NonNullable<Awaited<ReturnType<typeof getLlmConfig>>>;

export type AgentPlanDecision =
    | { kind: 'synthesize'; reason: string; skillsToLoad: string[] }
    | {
          kind: 'action';
          action: string;
          query?: string;
          memoryKey?: string;
          memoryContent?: string;
          memoryType?: 'fact' | 'observation' | 'plan' | 'result' | 'other';
          message?: string;
          code?: string;
          scriptType?: string;
          fileName?: string;
          reason?: string;
          skillsToLoad: string[];
      };

export type AgentVerifyVerdict = {
    verdict: 'continue' | 'ready_to_synthesize' | 'retry';
    reason: string;
    retryHint?: string;
    sourcesSeen?: string[];
    evidenceGaps?: string[];
    suggestedNextAction?: string;
    suggestedQuery?: string;
    researchBrief?: string;
};

const DOMAIN_SOURCES = ['notes', 'tasks', 'memo', 'lifeEvents', 'infoVault'] as const;

/** Detect which personal domains already appear in agent memory. */
export const detectSourcesSeenInMemory = (
    memories: Array<{ key: string; content: string }>
): string[] => {
    const seen = new Set<string>();
    for (const m of memories) {
        const blob = `${m.key}\n${m.content}`.toLowerCase();
        if (/\bnotes?\b|\[notes\]|search_notes/.test(blob)) seen.add('notes');
        if (/\btasks?\b|\[tasks\]|search_tasks/.test(blob)) seen.add('tasks');
        if (/\bmemos?\b|\[memo\]|search_memo/.test(blob)) seen.add('memo');
        if (/life[\s_-]?events?|\[lifeevents\]|search_life_events/.test(blob)) {
            seen.add('lifeEvents');
        }
        if (/info[\s_-]?vault|\[infovault\]|search_info_vault/.test(blob)) {
            seen.add('infoVault');
        }
    }
    return DOMAIN_SOURCES.filter((s) => seen.has(s));
};

/** Heuristic: goal likely needs grounded personal research before answering. */
export const isPersonalResearchGoal = (goalTitle: string, goalDescription: string): boolean => {
    const text = `${goalTitle}\n${goalDescription}`.toLowerCase();
    return (
        /\b(life|improve|advice|habit|goal|personal|notes?|tasks?|memo|health|career|relationship|plan|reflect|journal)\b/.test(
            text
        ) || /\bhow (can|do|should) i\b/.test(text)
    );
};

const pickMissingDomainAction = (sourcesSeen: string[]): string => {
    const missing = DOMAIN_SOURCES.find((s) => !sourcesSeen.includes(s));
    if (!missing) return 'write_memory';
    if (missing === 'lifeEvents') return 'search_life_events';
    if (missing === 'infoVault') return 'search_info_vault';
    return `search_${missing}`;
};

/**
 * Deterministic gate: refuse early synthesize on thin personal evidence.
 * LLM verify remains advisory; this enforces coverage for research-style goals.
 */
export const applyEvidenceGate = (params: {
    verify: AgentVerifyVerdict;
    memories: Array<{ key: string; content: string }>;
    goalTitle: string;
    goalDescription: string;
    forceSynthesize: boolean;
    activeSkillNames?: string[];
}): AgentVerifyVerdict => {
    const { memories, goalTitle, goalDescription, forceSynthesize, activeSkillNames } = params;
    let verify = { ...params.verify };

    if (forceSynthesize || verify.verdict === 'retry') {
        return verify;
    }

    const sourcesSeen =
        verify.sourcesSeen && verify.sourcesSeen.length > 0
            ? verify.sourcesSeen
            : detectSourcesSeenInMemory(memories);
    verify.sourcesSeen = sourcesSeen;

    const searchMemories = memories.filter((m) => /^search_/i.test(m.key));
    const personal =
        isPersonalResearchGoal(goalTitle, goalDescription) ||
        (activeSkillNames || []).includes('personal-research');

    if (verify.verdict !== 'ready_to_synthesize' || !personal) {
        return verify;
    }

    const tooFewSources = sourcesSeen.length < 2;
    const onlyOneSearch = searchMemories.length < 2 && sourcesSeen.length < 3;
    const emptyish = memories.length === 0;

    if (emptyish || tooFewSources || onlyOneSearch) {
        const suggestedNextAction =
            verify.suggestedNextAction ||
            (sourcesSeen.length === 0 ? 'search_all_domains' : pickMissingDomainAction(sourcesSeen));
        const gaps =
            verify.evidenceGaps && verify.evidenceGaps.length > 0
                ? verify.evidenceGaps
                : [
                      emptyish
                          ? 'No evidence in memory yet'
                          : `Only covered: ${sourcesSeen.join(', ') || 'none'}`,
                  ];
        return {
            ...verify,
            verdict: 'continue',
            reason: (verify.reason || 'Need broader domain coverage before synthesize').slice(0, 200),
            evidenceGaps: gaps.slice(0, 6),
            suggestedNextAction,
            suggestedQuery:
                verify.suggestedQuery ||
                goalTitle ||
                goalDescription.slice(0, 200),
        };
    }

    return verify;
};

const extractJsonObject = (raw: string): Record<string, unknown> | null => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        /* try regex */
    }
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            const parsed = JSON.parse(match[0]);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return null;
        }
    }
    return null;
};

const parseSkillsToLoad = (json: Record<string, unknown> | null): string[] => {
    if (!json || !Array.isArray(json.skillsToLoad)) return [];
    return json.skillsToLoad
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);
};

/**
 * Plan the next agent step (tool action vs synthesize final answer).
 * Agent-native — does not call Answer Machine.
 */
export const planAgentStep = async (params: {
    logCtx: AgentLogContext;
    llmConfig: LlmConfig;
    toolDescriptions: string;
    goalTitle: string;
    goalDescription: string;
    memorySummary: string;
    recentToolSummary: string;
    tickNumber: number;
    recentNoopCount: number;
    skillsCatalog: AgentSkillCatalogItem[];
    activeSkillsBlock?: string;
    budgetContext?: Record<string, unknown>;
}): Promise<AgentPlanDecision> => {
    const {
        logCtx,
        llmConfig,
        toolDescriptions,
        goalTitle,
        goalDescription,
        memorySummary,
        recentToolSummary,
        tickNumber,
        recentNoopCount,
        skillsCatalog,
        activeSkillsBlock,
        budgetContext,
    } = params;

    const catalogText = skillsCatalog.length
        ? skillsCatalog.map((s) => `- ${s.name}: ${s.description}`).join('\n')
        : '(no skills installed)';

    const systemPrompt = `You are the PLANNER for an autonomous personal-data agent.
The user is NOT available for clarifying questions.

${AGENT_SHELL_ENV_BLURB}

Your job each tick:
1) Optionally load up to 3 skills via skillsToLoad (by name from the catalog) when their descriptions match the goal.
2) Decide if you already have enough evidence in MEMORY / prior tool results → readyToSynthesize=true
3) Otherwise choose ONE next tool action.

Prefer this workflow for life/advice questions (e.g. "how to improve my life"):
- Load skill "personal-research" when relevant
- First call search_all_domains with a focused query (or the user question)
- Optionally deepen with search_notes / search_tasks / search_memo / search_life_events / search_info_vault
- Store important findings with write_memory
- When enough evidence exists, set readyToSynthesize=true (do NOT invent personal facts)

For file/script goals (resize/compress images, generate files):
- Load "shell-environment" and/or "image-media" when relevant
- Use execute_script with scriptType "python" for image work (Pillow) and fileName ending in .py
- Use execute_script with scriptType "node" for JS; fileName ending in .js
- Never run a .py file with node

Available skills (name + when to use):
${catalogText}

Available tools:
${toolDescriptions}

${activeSkillsBlock ? `${activeSkillsBlock}\n` : ''}
Reply JSON ONLY:
{
  "readyToSynthesize": boolean,
  "skillsToLoad": ["skill-name"],
  "action": "<tool_name when readyToSynthesize is false>",
  "query": "search query",
  "memoryKey": "optional",
  "memoryContent": "optional",
  "memoryType": "fact"|"observation"|"plan"|"result"|"other",
  "message": "optional chat text",
  "code": "optional script source",
  "scriptType": "node"|"python (REQUIRED for execute_script — use python for images/Pillow)",
  "fileName": "script.py or script.js matching scriptType",
  "reason": "short why"
}

Rules:
- For personal questions, search domains BEFORE synthesizing.
- Use search_all_domains early when the goal needs notes/tasks/memos/life events/info vault.
- If memory contains a next_step_* plan entry, prefer that action/query unless obsolete.
- Prefer research_brief memory when deciding readyToSynthesize.
- Honor the budget block: do not synthesize before minsMet unless maxExceeded/nearMax; prefer synthesize when near max.
- If recentNoopCount >= 2 or budget is near/at max and memory has findings, prefer readyToSynthesize=true.
- Never call Answer Machine. You are the agent planner.`;

    const userPrompt = JSON.stringify(
        {
            currentGoal: { title: goalTitle, description: goalDescription },
            tickNumber,
            recentNoopCount,
            budget: budgetContext || null,
            memory: memorySummary,
            recentToolResults: recentToolSummary,
            instruction:
                recentNoopCount >= 2
                    ? 'Too many noops. Prefer readyToSynthesize=true with best available evidence.'
                    : 'Honor next_step_* memory if present. Plan one next step toward a grounded final answer. Respect budget percentages.',
        },
        null,
        2
    );

    const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    const llmResult = await fetchLlmUnifiedLogged({
        logCtx,
        purpose: 'agent_plan',
        params: {
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages,
            temperature: 0.25,
            maxTokens: 2000,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
        },
    });

    const json = extractJsonObject(llmResult.content || '');
    const skillsToLoad = parseSkillsToLoad(json);

    if (!json) {
        return {
            kind: 'action',
            action: 'search_all_domains',
            query: goalTitle || goalDescription,
            reason: 'Planner JSON parse failed; defaulting to multi-domain search',
            skillsToLoad,
        };
    }

    const ready = json.readyToSynthesize === true;
    const reason = typeof json.reason === 'string' ? json.reason : '';

    if (ready) {
        return { kind: 'synthesize', reason: reason || 'Enough evidence to answer', skillsToLoad };
    }

    const action = typeof json.action === 'string' && json.action.trim() ? json.action.trim() : 'search_all_domains';
    return {
        kind: 'action',
        action,
        query: typeof json.query === 'string' ? json.query : undefined,
        memoryKey: typeof json.memoryKey === 'string' ? json.memoryKey : undefined,
        memoryContent: typeof json.memoryContent === 'string' ? json.memoryContent : undefined,
        memoryType:
            json.memoryType === 'fact' ||
            json.memoryType === 'observation' ||
            json.memoryType === 'plan' ||
            json.memoryType === 'result'
                ? json.memoryType
                : 'other',
        message: typeof json.message === 'string' ? json.message : undefined,
        code: typeof json.code === 'string' ? json.code : undefined,
        scriptType: typeof json.scriptType === 'string' ? json.scriptType : undefined,
        fileName: typeof json.fileName === 'string' ? json.fileName : undefined,
        reason,
        skillsToLoad,
    };
};

/**
 * Verify whether the latest tool result is enough to synthesize a final answer.
 */
export const verifyAgentStep = async (params: {
    logCtx: AgentLogContext;
    llmConfig: LlmConfig;
    goalTitle: string;
    goalDescription: string;
    lastAction: string;
    lastResultSummary: string;
    memorySummary: string;
    activeSkillsBlock?: string;
    budgetContext?: Record<string, unknown>;
}): Promise<AgentVerifyVerdict> => {
    const {
        logCtx,
        llmConfig,
        goalTitle,
        goalDescription,
        lastAction,
        lastResultSummary,
        memorySummary,
        activeSkillsBlock,
        budgetContext,
    } = params;

    const messages: Message[] = [
        {
            role: 'system',
            content:
                'You verify one agent tool step against the user goal. Reply JSON ONLY:\n' +
                '{\n' +
                '  "verdict":"continue"|"ready_to_synthesize"|"retry",\n' +
                '  "reason":"max 200 chars",\n' +
                '  "retryHint":"optional",\n' +
                '  "sourcesSeen":["notes"|"tasks"|"memo"|"lifeEvents"|"infoVault"],\n' +
                '  "evidenceGaps":["short gap"],\n' +
                '  "suggestedNextAction":"search_notes|search_tasks|search_memo|search_life_events|search_info_vault|search_all_domains|write_memory",\n' +
                '  "suggestedQuery":"focused next search query",\n' +
                '  "researchBrief":"5-12 short bullets of grounded findings + unknowns"\n' +
                '}\n' +
                '- ready_to_synthesize: enough multi-source evidence for a grounded final answer.\n' +
                '- continue: more search/tools still needed (prefer this after a single thin search).\n' +
                '- retry: last action failed or was useless; set retryHint.\n' +
                'For personal advice goals, require evidence from at least 2 domains ' +
                '(notes/tasks/memos/life events/info vault) before ready_to_synthesize.\n' +
                'Always fill researchBrief from memory when any findings exist.\n' +
                'Honor budget: do not ready_to_synthesize before minsMet unless maxExceeded/nearMax.\n' +
                (activeSkillsBlock ? `\n${activeSkillsBlock}` : ''),
        },
        {
            role: 'user',
            content: JSON.stringify(
                {
                    goal: { title: goalTitle, description: goalDescription },
                    lastAction,
                    lastResultSummary: lastResultSummary.slice(0, 4000),
                    memory: memorySummary.slice(0, 6000),
                    budget: budgetContext || null,
                },
                null,
                2
            ),
        },
    ];

    const llmResult = await fetchLlmUnifiedLogged({
        logCtx,
        purpose: 'agent_verify',
        params: {
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages,
            temperature: 0.2,
            maxTokens: 1200,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
        },
    });

    const json = extractJsonObject(llmResult.content || '');
    const verdictRaw = typeof json?.verdict === 'string' ? json.verdict : 'continue';
    const verdict: AgentVerifyVerdict['verdict'] =
        verdictRaw === 'ready_to_synthesize' || verdictRaw === 'retry' ? verdictRaw : 'continue';

    const asStringArray = (v: unknown, max: number): string[] | undefined => {
        if (!Array.isArray(v)) return undefined;
        const out = v
            .filter((x): x is string => typeof x === 'string')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, max);
        return out.length ? out : undefined;
    };

    return {
        verdict,
        reason: typeof json?.reason === 'string' ? json.reason.slice(0, 200) : '',
        retryHint: typeof json?.retryHint === 'string' ? json.retryHint.slice(0, 400) : undefined,
        sourcesSeen: asStringArray(json?.sourcesSeen, 8),
        evidenceGaps: asStringArray(json?.evidenceGaps, 6),
        suggestedNextAction:
            typeof json?.suggestedNextAction === 'string'
                ? json.suggestedNextAction.slice(0, 80)
                : undefined,
        suggestedQuery:
            typeof json?.suggestedQuery === 'string' ? json.suggestedQuery.slice(0, 300) : undefined,
        researchBrief:
            typeof json?.researchBrief === 'string' ? json.researchBrief.slice(0, 4000) : undefined,
    };
};

/**
 * Synthesize a final grounded answer from agent memory + goal.
 * When chatMessageId is provided, streams tokens into that chat row.
 */
export const synthesizeAgentAnswer = async (params: {
    logCtx: AgentLogContext;
    llmConfig: LlmConfig;
    goalTitle: string;
    goalDescription: string;
    memorySummary: string;
    pastChatSummary: string;
    activeSkillsBlock?: string;
    chatMessageId?: mongoose.Types.ObjectId | string;
    budgetContext?: Record<string, unknown>;
}): Promise<string> => {
    const {
        logCtx,
        llmConfig,
        goalTitle,
        goalDescription,
        memorySummary,
        pastChatSummary,
        activeSkillsBlock,
        chatMessageId,
        budgetContext,
    } = params;

    const messages: Message[] = [
        {
            role: 'system',
            content:
                'You write the FINAL ANSWER for an autonomous personal agent.\n' +
                'Citation-first: prefer claims that map to MEMORY evidence; cite sources inline like [notes], [tasks], [memo], [lifeEvents], [infoVault] when used.\n' +
                'Prefer memories keyed research_brief / fact / result as the outline; treat raw search_* dumps as supporting sources only.\n' +
                'If evidence is thin or missing for a claim, mark it clearly as (speculative) — do not invent personal history.\n' +
                'Open with a one-line confidence note when evidence is limited (e.g. "Based on limited notes/tasks…").\n' +
                'Be practical, specific, and structured (short sections / bullets).\n' +
                'Return plain text only (no JSON). Aim for a complete useful answer the user can act on.\n' +
                (activeSkillsBlock ? `\n${activeSkillsBlock}` : ''),
        },
        {
            role: 'user',
            content: [
                `GOAL TITLE:\n${goalTitle}`,
                `GOAL / USER REQUEST:\n${goalDescription}`,
                pastChatSummary ? `RECENT CHAT:\n${pastChatSummary}` : '',
                `EVIDENCE FROM NOTES / TASKS / MEMOS / LIFE EVENTS / INFO VAULT / AGENT MEMORY:\n${memorySummary || '(none)'}`,
                budgetContext
                    ? `BUDGET STATUS (used / remaining %):\n${JSON.stringify(budgetContext, null, 2)}`
                    : '',
                'Prefer research_brief if present. Cite domains inline. Mark speculative parts. Write the final answer now.',
            ]
                .filter(Boolean)
                .join('\n\n'),
        },
    ];

    const llmParams = {
        provider: llmConfig.provider as
            | 'groq'
            | 'openrouter'
            | 'ollama'
            | 'localai'
            | 'openai-compatible',
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages,
        temperature: 0.4,
        maxTokens: 4000,
        headersExtra: llmConfig.customHeaders,
    };

    const applyStreamUsage = async (usage: {
        promptTokens: number;
        completionTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costInUsd: number;
    }) => {
        if (!logCtx.agentInstanceId) return;
        const prompt = Number(usage.promptTokens) || 0;
        const completion = Number(usage.completionTokens) || 0;
        try {
            await ModelAgentInstance.updateOne(
                { _id: logCtx.agentInstanceId },
                {
                    $inc: {
                        promptTokens: prompt,
                        completionTokens: completion,
                        reasoningTokens: Number(usage.reasoningTokens) || 0,
                        totalTokens: Number(usage.totalTokens) || 0,
                        costInUsd: Number(usage.costInUsd) || 0,
                    },
                    $max: {
                        maxPromptTokensPerQuery: prompt,
                        maxCompletionTokensPerQuery: completion,
                    },
                    $set: { updatedAtUtc: new Date() },
                }
            );
        } catch (e) {
            console.error('agent stream token increment failed:', e);
        }
    };

    // Streaming path when a chat placeholder exists
    if (chatMessageId) {
        await writeAgentLog({
            ...logCtx,
            action: 'llm_call_start',
            title: 'LLM → agent synthesize (stream)',
            message: `Streaming synthesize via ${llmConfig.provider}/${llmConfig.model}`,
            payload: { purpose: 'agent_synthesize', streaming: true },
        });

        let fullContent = '';
        let lastUpdateTime = Date.now();
        let updateIntervalMs = 400;
        let cancelled = false;

        try {
            const streamResult = await fetchLlmUnifiedStream(llmParams, async ({ token }) => {
                fullContent += token;
                const now = Date.now();
                if (now - lastUpdateTime >= updateIntervalMs) {
                    updateIntervalMs = 800;
                    lastUpdateTime = now;
                    // Stop streaming writes if user cancelled
                    const agentDoc = await ModelAgentInstance.findById(logCtx.agentInstanceId)
                        .select('cancellationRequestedUtc')
                        .lean();
                    if (agentDoc?.cancellationRequestedUtc) {
                        cancelled = true;
                        return;
                    }
                    await ModelChatLlm.findByIdAndUpdate(chatMessageId, {
                        $set: {
                            content: fullContent.slice(0, 12000),
                            updatedAtUtc: new Date(),
                        },
                    });
                }
            });

            await applyStreamUsage(streamResult);

            const answer = (streamResult.fullContent || fullContent || '').trim().slice(0, 12000);
            const finalContent =
                cancelled || streamResult.cancelled
                    ? answer
                        ? `${answer}\n\n(Generation stopped.)`
                        : '(Generation cancelled.)'
                    : answer;

            await ModelChatLlm.findByIdAndUpdate(chatMessageId, {
                $set: {
                    content: finalContent || 'Limited personal context found — parts marked speculative.',
                    promptTokens: streamResult.promptTokens || 0,
                    completionTokens: streamResult.completionTokens || 0,
                    reasoningTokens: streamResult.reasoningTokens || 0,
                    totalTokens: streamResult.totalTokens || 0,
                    costInUsd: streamResult.costInUsd || 0,
                    updatedAtUtc: new Date(),
                },
            });

            await writeAgentLog({
                ...logCtx,
                action: streamResult.success ? 'llm_call_end' : 'llm_call_error',
                title: streamResult.success
                    ? 'LLM ✓ agent synthesize (stream)'
                    : 'LLM ✗ agent synthesize (stream)',
                message: streamResult.success
                    ? `Streamed ${streamResult.totalTokens || 0} tokens`
                    : streamResult.error || 'stream failed',
                payload: {
                    purpose: 'agent_synthesize',
                    streaming: true,
                    cancelled: Boolean(cancelled || streamResult.cancelled),
                },
            });

            if (finalContent) return finalContent;
        } catch (streamErr) {
            console.error('agent synthesize stream failed, falling back:', streamErr);
            await writeAgentLog({
                ...logCtx,
                action: 'llm_call_error',
                title: 'LLM ✗ agent synthesize stream',
                message: streamErr instanceof Error ? streamErr.message : String(streamErr),
                level: 'warn',
            });
            // fall through to non-stream
        }
    }

    const llmResult = await fetchLlmUnifiedLogged({
        logCtx,
        purpose: 'agent_synthesize',
        params: llmParams,
    });

    const answer = (llmResult.content || '').trim();
    if (answer) {
        if (chatMessageId) {
            await ModelChatLlm.findByIdAndUpdate(chatMessageId, {
                $set: {
                    content: answer.slice(0, 12000),
                    promptTokens: llmResult.usageStats?.promptTokens || 0,
                    completionTokens: llmResult.usageStats?.completionTokens || 0,
                    reasoningTokens: llmResult.usageStats?.reasoningTokens || 0,
                    totalTokens: llmResult.usageStats?.totalTokens || 0,
                    costInUsd: llmResult.usageStats?.costInUsd || 0,
                    updatedAtUtc: new Date(),
                },
            });
        }
        return answer.slice(0, 12000);
    }

    await writeAgentLog({
        agentInstanceId: logCtx.agentInstanceId,
        userId: logCtx.userId,
        threadId: logCtx.threadId,
        action: 'agent_error',
        message: 'Synthesize returned empty content',
        level: 'warn',
        goalId: logCtx.goalId || null,
        tickNumber: logCtx.tickNumber || 0,
    });

    const fallback =
        `Based on available personal context for "${goalTitle}":\n\n` +
        `${memorySummary.slice(0, 3000) || 'No domain evidence was collected yet.'}\n\n` +
        `I could not fully synthesize a richer answer this tick — try sending the question again.`;

    if (chatMessageId) {
        await ModelChatLlm.findByIdAndUpdate(chatMessageId, {
            $set: { content: fallback, updatedAtUtc: new Date() },
        });
    }

    return fallback;
};

export const formatMemorySummary = (
    memories: Array<{ key: string; memoryType?: string; content: string }>
): string =>
    memories
        .slice(0, 25)
        .map((m) => `- [${m.memoryType || 'other'}] ${m.key}: ${m.content.slice(0, 800)}`)
        .join('\n')
        .slice(0, 12000);
