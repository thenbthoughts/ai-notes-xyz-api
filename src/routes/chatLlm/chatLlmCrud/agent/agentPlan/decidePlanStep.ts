import { Message } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../../chatUtils/chatLlmGetLlmConfig';
import writeAgentLog, { fetchLlmUnifiedLogged, type AgentLogContext } from '../agentUtils/agentWriteLog';
import { withContextChatMessages, type AgentChatWindow } from '../agentUtils/agentContextWindow';

export type PlanProbeAction = {
    action: string;
    query?: string;
    memoryKey?: string;
    memoryContent?: string;
    reason?: string;
};

export type PlanStepDecision =
    | {
          mode: 'probe';
          reason: string;
          contextNotes: string;
          probes: PlanProbeAction[];
      }
    | {
          mode: 'expand';
          reason: string;
          contextNotes: string;
          probes: [];
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
        /* continue */
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
        } catch {
            return null;
        }
    }
    return null;
};

/** Plan stage never runs shell / execute_script. */
const ALLOWED_PROBE_ACTIONS = new Set([
    'list_workspace_files',
    'write_memory',
    'search_all_domains',
    'search_notes',
    'search_tasks',
    'search_memo',
    'search_life_events',
    'search_info_vault',
]);

/**
 * Decide whether to gather light context or expand goals into a plan.
 * No shell / execute_script in plan.
 */
export const decidePlanStep = async (params: {
    logCtx: AgentLogContext;
    userRequest: string;
    goalsSummary: string;
    existingPlanContext: string;
    probeCount: number;
    maxProbes: number;
    contextPack?: string;
    chatMessages?: Message[] | AgentChatWindow;
}): Promise<PlanStepDecision> => {
    const {
        logCtx,
        userRequest,
        goalsSummary,
        existingPlanContext,
        probeCount,
        maxProbes,
        contextPack,
        chatMessages,
    } = params;

    if (probeCount >= maxProbes) {
        return {
            mode: 'expand',
            reason: `Probe budget reached (${probeCount}/${maxProbes}); expanding`,
            contextNotes: existingPlanContext.slice(0, 2000),
            probes: [],
        };
    }

    const llmConfig = await getLlmConfig({ threadId: logCtx.threadId });
    if (!llmConfig) {
        return {
            mode: 'expand',
            reason: 'No LLM config — expand without probes',
            contextNotes: '',
            probes: [],
        };
    }

    const messages: Message[] = withContextChatMessages(
        {
            role: 'system',
            content: `You are the PLAN step of the Agent Brain.
Brain loop: Think → Plan → Use Tool → Observe → Repeat → Final Answer.

Prefer mode=expand quickly. Shell / execute_script is for later Use Tool steps — not for planning probes.

Allowed probe tools (optional, rare):
- list_workspace_files — only if locating existing uploads/files matters for the plan
- write_memory — short planning note
- search_all_domains / search_notes / search_tasks / search_memo / search_life_events / search_info_vault — only for personal-data planning

Reply JSON ONLY:
{
  "mode": "probe"|"expand",
  "reason": "short why",
  "contextNotes": "what we know / still need",
  "probes": [
    {
      "action": "list_workspace_files|write_memory|search_all_domains|...",
      "query": "optional",
      "memoryKey": "optional",
      "memoryContent": "optional",
      "reason": "optional"
    }
  ]
}

Rules:
- Default to mode=expand for create-file / one-shot requests (PDF, Excel, image, scripts).
- Do NOT choose execute_script or any shell command.
- Max 1 probe this tick if probing at all.`,
        },
        chatMessages,
        {
            role: 'user',
            content: JSON.stringify(
                {
                    userRequest: userRequest.slice(0, 4000),
                    goals: goalsSummary.slice(0, 2000),
                    existingPlanContext: existingPlanContext.slice(0, 6000) || null,
                    context: contextPack || null,
                    probeCount,
                    maxProbes,
                },
                null,
                2
            ),
        }
    );

    try {
        const llmResult = await fetchLlmUnifiedLogged({
            logCtx,
            purpose: 'agent_plan_decide',
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
        const mode = json?.mode === 'probe' ? 'probe' : 'expand';
        const reason =
            typeof json?.reason === 'string' && json.reason.trim()
                ? json.reason.trim().slice(0, 300)
                : mode === 'probe'
                  ? 'Gathering plan context'
                  : 'Ready to expand';
        const contextNotes =
            typeof json?.contextNotes === 'string' ? json.contextNotes.trim().slice(0, 4000) : '';

        const probes: PlanProbeAction[] = [];
        if (mode === 'probe' && Array.isArray(json?.probes)) {
            for (const raw of json!.probes) {
                if (!raw || typeof raw !== 'object') continue;
                const o = raw as Record<string, unknown>;
                const action = typeof o.action === 'string' ? o.action.trim() : '';
                if (!ALLOWED_PROBE_ACTIONS.has(action)) continue;
                if (action === 'execute_script') continue;
                probes.push({
                    action,
                    query: typeof o.query === 'string' ? o.query : undefined,
                    memoryKey: typeof o.memoryKey === 'string' ? o.memoryKey : undefined,
                    memoryContent: typeof o.memoryContent === 'string' ? o.memoryContent : undefined,
                    reason: typeof o.reason === 'string' ? o.reason : undefined,
                });
                if (probes.length >= 1) break;
            }
        }

        if (mode === 'probe' && probes.length === 0) {
            return {
                mode: 'expand',
                reason: reason || 'No valid non-shell probes — expanding',
                contextNotes,
                probes: [],
            };
        }

        if (mode === 'probe') {
            return { mode: 'probe', reason, contextNotes, probes };
        }
        return { mode: 'expand', reason, contextNotes, probes: [] };
    } catch (e) {
        await writeAgentLog({
            ...logCtx,
            action: 'plan_decide_error',
            message: e instanceof Error ? e.message : String(e),
            level: 'warn',
        });
        return {
            mode: 'expand',
            reason: 'Plan decide failed — expand with existing context',
            contextNotes: existingPlanContext.slice(0, 2000),
            probes: [],
        };
    }
};
