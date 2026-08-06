import { Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../answerMachineShared/answerMachineGetLlmConfig';
import writeAgentLog, { fetchLlmUnifiedLogged, AgentLogContext } from './agentWriteLog';
import { AGENT_SHELL_ENV_BLURB } from './agentShellEnvironmentContext';
import type { AgentSkillCatalogItem } from './agentSkillsLib';

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
- If recentNoopCount >= 2 or tickNumber is high and memory has findings, prefer readyToSynthesize=true.
- Never call Answer Machine. You are the agent planner.`;

    const userPrompt = JSON.stringify(
        {
            currentGoal: { title: goalTitle, description: goalDescription },
            tickNumber,
            recentNoopCount,
            memory: memorySummary,
            recentToolResults: recentToolSummary,
            instruction:
                recentNoopCount >= 2
                    ? 'Too many noops. Prefer readyToSynthesize=true with best available evidence.'
                    : 'Plan one next step toward a grounded final answer.',
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
    } = params;

    const messages: Message[] = [
        {
            role: 'system',
            content:
                'You verify one agent tool step against the user goal. Reply JSON ONLY: ' +
                '{"verdict":"continue"|"ready_to_synthesize"|"retry","reason":"max 200 chars","retryHint":"optional"}.\n' +
                '- ready_to_synthesize: memory + last result are enough for a grounded final answer.\n' +
                '- continue: more search/tools still needed.\n' +
                '- retry: last action failed or was useless; set retryHint.\n' +
                'For personal advice goals, require evidence from notes/tasks/memos/life events/info vault before ready_to_synthesize.\n' +
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
            maxTokens: 800,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
        },
    });

    const json = extractJsonObject(llmResult.content || '');
    const verdictRaw = typeof json?.verdict === 'string' ? json.verdict : 'continue';
    const verdict: AgentVerifyVerdict['verdict'] =
        verdictRaw === 'ready_to_synthesize' || verdictRaw === 'retry' ? verdictRaw : 'continue';

    return {
        verdict,
        reason: typeof json?.reason === 'string' ? json.reason.slice(0, 200) : '',
        retryHint: typeof json?.retryHint === 'string' ? json.retryHint.slice(0, 400) : undefined,
    };
};

/**
 * Synthesize a final grounded answer from agent memory + goal.
 */
export const synthesizeAgentAnswer = async (params: {
    logCtx: AgentLogContext;
    llmConfig: LlmConfig;
    goalTitle: string;
    goalDescription: string;
    memorySummary: string;
    pastChatSummary: string;
    activeSkillsBlock?: string;
}): Promise<string> => {
    const {
        logCtx,
        llmConfig,
        goalTitle,
        goalDescription,
        memorySummary,
        pastChatSummary,
        activeSkillsBlock,
    } = params;

    const messages: Message[] = [
        {
            role: 'system',
            content:
                'You write the FINAL ANSWER for an autonomous personal agent.\n' +
                'Ground every claim in the provided MEMORY / domain search evidence.\n' +
                'If evidence is thin, say what is known vs unknown — do not invent personal history.\n' +
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
                'Write the final answer now.',
            ]
                .filter(Boolean)
                .join('\n\n'),
        },
    ];

    const llmResult = await fetchLlmUnifiedLogged({
        logCtx,
        purpose: 'agent_synthesize',
        params: {
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages,
            temperature: 0.4,
            maxTokens: 4000,
            headersExtra: llmConfig.customHeaders,
        },
    });

    const answer = (llmResult.content || '').trim();
    if (answer) return answer.slice(0, 12000);

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

    return (
        `Based on available personal context for "${goalTitle}":\n\n` +
        `${memorySummary.slice(0, 3000) || 'No domain evidence was collected yet.'}\n\n` +
        `I could not fully synthesize a richer answer this tick — try sending the question again.`
    );
};

export const formatMemorySummary = (
    memories: Array<{ key: string; memoryType?: string; content: string }>
): string =>
    memories
        .slice(0, 25)
        .map((m) => `- [${m.memoryType || 'other'}] ${m.key}: ${m.content.slice(0, 800)}`)
        .join('\n')
        .slice(0, 12000);
