import { Message } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { fetchLlmUnifiedStream } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../../chatUtils/chatLlmGetLlmConfig';
import writeAgentLog, { fetchLlmUnifiedLogged, AgentLogContext } from '../agentUtils/agentWriteLog';
import { AGENT_SHELL_ENV_BLURB } from '../agentUtils/agentShell/agentShellEnvironmentContext';
import type { AgentSkillCatalogItem } from '../../agentSkills/agentSkillsLib';
import { ModelAgentInstance } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelChatLlm } from '../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import mongoose from 'mongoose';

type LlmConfig = NonNullable<Awaited<ReturnType<typeof getLlmConfig>>>;

/** Brain Plan decision: use a tool, expand goals, or write the final answer */
export type AgentBrainDecisionMode = 'use_tool' | 'expand_goals' | 'final_answer';

export type AgentPlanDecision =
    | {
          kind: 'final_answer';
          mode: 'final_answer';
          reason: string;
          skillsToLoad: string[];
          /** Optional verification / closing script before final answer */
          action?: string;
          query?: string;
          code?: string;
          scriptType?: string;
          fileName?: string;
      }
    | {
          kind: 'expand_goals';
          mode: 'expand_goals';
          reason: string;
          skillsToLoad: string[];
      }
    | {
          kind: 'use_tool';
          mode: 'use_tool';
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

/**
 * Detect created workspace artifact paths from tool/memory text.
 * Bare filenames (e.g. passwords.xlsx in the user request) do NOT count —
 * require a grounded workspace / absolute path so the agent cannot finalize
 * before the file actually exists.
 */
export const detectArtifactEvidence = (
    memories: Array<{ key: string; content: string }>,
    extraText = ''
): { hasArtifact: boolean; paths: string[]; extensions: string[] } => {
    const blobs = [
        ...memories.map((m) => `${m.key}\n${m.content}`),
        extraText,
    ].join('\n');
    // Require /app/data/... or ai-notes-xyz-shell-files/... (optional PDF_PATH= prefix).
    const pathRe =
        /(?:(?:PDF|XLSX|FILE|OUT)_PATH=)?(?:\/app\/data\/|ai-notes-xyz-shell-files\/)[^\s"'`<>|]{3,400}\.(pdf|xlsx|xls|csv|png|jpe?g|webp|gif|zip|docx)/gi;
    const paths: string[] = [];
    const extSet = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = pathRe.exec(blobs)) !== null) {
        let p = m[0].trim();
        p = p.replace(/^(?:PDF|XLSX|FILE|OUT)_PATH=/i, '');
        if (p.length >= 5 && !paths.includes(p)) {
            if (/\/venv\/|\/venv_|site-packages|__pycache__/i.test(p)) continue;
            paths.push(p.slice(0, 500));
            extSet.add((m[1] || '').toLowerCase());
        }
    }
    return { hasArtifact: paths.length > 0, paths, extensions: [...extSet] };
};

const DELIVERABLE_EXT_RE =
    /\.(pdf|xlsx|xls|csv|png|jpe?g|webp|gif|zip|docx|txt|md|eml|html|json|ics)$/i;

/**
 * Non-venv workspace files that look like user deliverables (size > 0).
 * Used to stop endless "verify with pandas" loops once the file exists.
 * Fixture inputs are excluded via workspace baseline (not by skipping uploads/).
 */
export const listWorkspaceDeliverables = (
    listing: Array<{
        relativePath: string;
        pathInAgentFolder?: string;
        absolutePath?: string;
        isDir?: boolean;
        size?: number;
    }>
): Array<{ relativePath: string; pathInAgentFolder: string; absolutePath: string; size: number }> => {
    const out: Array<{
        relativePath: string;
        pathInAgentFolder: string;
        absolutePath: string;
        size: number;
    }> = [];
    for (const f of listing || []) {
        if (!f || f.isDir) continue;
        const rel = String(f.relativePath || '').replace(/\\/g, '/');
        if (!rel || !DELIVERABLE_EXT_RE.test(rel)) continue;
        if (/\/venv\/|\/venv_|\.agent_venv\/|site-packages|__pycache__|\.dist-info\//i.test(rel)) continue;
        const pathInAgentFolder = String(f.pathInAgentFolder || rel.split('/').pop() || rel).replace(
            /\\/g,
            '/'
        );
        // Agent helper scripts are not user deliverables.
        const baseName = pathInAgentFolder.split('/').pop() || pathInAgentFolder;
        if (/^(script_\d+|create_artifact|plan_probe|tmp_)\./i.test(baseName)) {
            continue;
        }
        const size = typeof f.size === 'number' ? f.size : 0;
        if (size <= 0) continue;
        out.push({
            relativePath: rel,
            pathInAgentFolder,
            absolutePath: String(f.absolutePath || `/app/data/${rel}`),
            size,
        });
    }
    return out;
};

/** Keep only deliverables that were not present in the pre-run baseline (fixtures). */
export const filterNewDeliverables = (
    deliverables: ReturnType<typeof listWorkspaceDeliverables>,
    baselinePaths: Iterable<string>
): ReturnType<typeof listWorkspaceDeliverables> => {
    const base = new Set(
        [...baselinePaths].map((p) => String(p || '').replace(/\\/g, '/').toLowerCase())
    );
    if (base.size === 0) return deliverables;
    return deliverables.filter((d) => {
        const a = d.pathInAgentFolder.replace(/\\/g, '/').toLowerCase();
        const b = d.relativePath.replace(/\\/g, '/').toLowerCase();
        return !base.has(a) && !base.has(b) && !base.has(a.split('/').pop() || '');
    });
};

/**
 * Gate: when goal expansion expects a workspace file, require a real path before synthesize.
 */
export const applyArtifactGate = (params: {
    verify: AgentVerifyVerdict;
    memories: Array<{ key: string; content: string }>;
    expectsWorkspaceFile: boolean;
    acceptanceChecks?: string[];
    forceSynthesize: boolean;
    lastToolSummary?: string;
    /** Prefer real shell listing over text mentions. */
    workspaceHasDeliverable?: boolean;
}): AgentVerifyVerdict => {
    const {
        memories,
        expectsWorkspaceFile,
        acceptanceChecks,
        forceSynthesize,
        lastToolSummary,
        workspaceHasDeliverable,
    } = params;
    let verify = { ...params.verify };

    if (forceSynthesize || verify.verdict === 'retry') {
        return verify;
    }
    if (!expectsWorkspaceFile) {
        return verify;
    }
    if (verify.verdict !== 'ready_to_synthesize') {
        return verify;
    }

    // When a shell listing was checked, require a real non-upload deliverable on disk.
    // Do not trust LLM-mentioned /app/data/... paths alone (easy to hallucinate).
    if (typeof workspaceHasDeliverable === 'boolean') {
        if (workspaceHasDeliverable) {
            return verify;
        }
        return {
            ...verify,
            verdict: 'continue',
            reason: (
                verify.reason ||
                'No workspace deliverable on disk yet — create the file outside uploads/ and print absolute path + size'
            ).slice(0, 200),
            evidenceGaps: [
                ...(verify.evidenceGaps || []),
                ...(acceptanceChecks || []).slice(0, 3),
                'Need a created file visible in the agent workspace listing',
            ].slice(0, 6),
            suggestedNextAction: 'execute_script',
            retryHint:
                'Use execute_script to create the output file (not under uploads/) and print absolute path + size. Then list_workspace_files to confirm.',
        };
    }

    const evidence = detectArtifactEvidence(memories, lastToolSummary || '');
    const listed =
        /list_workspace_files|workspace files \(/i.test(lastToolSummary || '') &&
        evidence.paths.length > 0;

    if (!evidence.paths.length && !listed) {
        return {
            ...verify,
            verdict: 'continue',
            reason: (
                verify.reason ||
                'No workspace file path yet — create the deliverable and print its absolute path'
            ).slice(0, 200),
            evidenceGaps: [
                ...(verify.evidenceGaps || []),
                ...(acceptanceChecks || []).slice(0, 3),
                'Need a created file path in tool output or memory',
            ].slice(0, 6),
            suggestedNextAction: 'execute_script',
            retryHint:
                'Use execute_script to create the file (or list_workspace_files to locate it) and print absolute path + size.',
        };
    }

    return verify;
};

const pickMissingDomainAction = (sourcesSeen: string[]): string => {
    const missing = DOMAIN_SOURCES.find((s) => !sourcesSeen.includes(s));
    if (!missing) return 'write_memory';
    if (missing === 'lifeEvents') return 'search_life_events';
    if (missing === 'infoVault') return 'search_info_vault';
    return `search_${missing}`;
};

/**
 * Gate: when expansion says personal data is required, require domain coverage before synthesize.
 * Also forces synthesize once coverage is good enough so research cannot loop forever.
 */
export const applyEvidenceGate = (params: {
    verify: AgentVerifyVerdict;
    memories: Array<{ key: string; content: string }>;
    requiresPersonalData: boolean;
    forceSynthesize: boolean;
    tickNumber?: number;
}): AgentVerifyVerdict => {
    const { memories, requiresPersonalData, forceSynthesize, tickNumber = 0 } = params;
    let verify = { ...params.verify };

    if (forceSynthesize || verify.verdict === 'retry') {
        return verify;
    }
    if (!requiresPersonalData) {
        return verify;
    }

    const sourcesSeen =
        verify.sourcesSeen && verify.sourcesSeen.length > 0
            ? verify.sourcesSeen
            : detectSourcesSeenInMemory(memories);
    verify.sourcesSeen = sourcesSeen;

    const searchMemories = memories.filter((m) => /^search_/i.test(m.key));
    const searchCount = searchMemories.length;
    const enoughCoverage = sourcesSeen.length >= 2 && searchCount >= 2;
    const researchCap =
        (sourcesSeen.length >= 1 && searchCount >= 4) ||
        (sourcesSeen.length >= 2 && tickNumber >= 8) ||
        (searchCount >= 6 && tickNumber >= 6);

    if (enoughCoverage || researchCap) {
        return {
            ...verify,
            verdict: 'ready_to_synthesize',
            reason: (
                researchCap && !enoughCoverage
                    ? `Personal research cap — synthesize with available evidence (${sourcesSeen.join(', ') || 'partial'})`
                    : `Personal domain coverage OK (${sourcesSeen.join(', ')})`
            ).slice(0, 200),
            evidenceGaps: [],
            suggestedNextAction: undefined,
            suggestedQuery: undefined,
        };
    }

    if (verify.verdict !== 'ready_to_synthesize') {
        return verify;
    }

    const tooFewSources = sourcesSeen.length < 2;
    const onlyOneSearch = searchCount < 2 && sourcesSeen.length < 3;
    const emptyish = memories.length === 0;

    if (emptyish || tooFewSources || onlyOneSearch) {
        return {
            ...verify,
            verdict: 'continue',
            reason: (verify.reason || 'Need broader personal-data coverage before synthesize').slice(
                0,
                200
            ),
            evidenceGaps: (
                verify.evidenceGaps || [
                    emptyish
                        ? 'No evidence in memory yet'
                        : `Only covered: ${sourcesSeen.join(', ') || 'none'}`,
                ]
            ).slice(0, 6),
            suggestedNextAction:
                verify.suggestedNextAction ||
                (sourcesSeen.length === 0 ? 'search_all_domains' : pickMissingDomainAction(sourcesSeen)),
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
 * Brain PLAN controller: choose mode (use_tool | expand_goals | final_answer)
 * and optionally one tool action. Agent-native — does not call Answer Machine.
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
    goalExpansion?: Record<string, unknown> | null;
    childResultsPack?: string;
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
        goalExpansion,
        childResultsPack,
    } = params;

    const catalogText = skillsCatalog.length
        ? skillsCatalog.map((s) => `- ${s.name}: ${s.description}`).join('\n')
        : '(no skills installed)';

    const requiresShell = goalExpansion?.requiresShell === true;
    const requiresPersonalData = goalExpansion?.requiresPersonalData === true;
    const suggestedTools = Array.isArray(goalExpansion?.suggestedTools)
        ? (goalExpansion!.suggestedTools as string[])
        : [];
    const defaultAction =
        suggestedTools[0] ||
        (requiresShell ? 'execute_script' : requiresPersonalData ? 'search_all_domains' : 'search_all_domains');

    const systemPrompt = `You are the WORK-STAGE controller for an autonomous agent.
The user is NOT available for clarifying questions.

${AGENT_SHELL_ENV_BLURB}

Agent Brain: Think → Plan → Use Tool → Observe → Repeat → Final Answer.
You are the PLAN step of the Agent Brain loop:
Think → Plan → Use Tool → Observe → Repeat → Final Answer.

Choose ONE mode:
- "use_tool": run ONE tool action that advances the goal
- "final_answer": write the final answer when ready. May optionally include action+code for a short verification script first.
- "expand_goals": current plan/sub-goals are wrong; expand or revise goals before continuing

Use GOAL EXPANSION as source of truth for outputFormat / expectations / approach.
If CHILD RESULTS PACK is present, this is a parent goal — use those detailed sub-goal results; do not redo finished child work.

Available skills (name + when to use):
${catalogText}

Available tools (when mode=use_tool, or optionally on final_answer for a check script):
${toolDescriptions}

${activeSkillsBlock ? `${activeSkillsBlock}\n` : ''}
Reply JSON ONLY:
{
  "mode": "use_tool"|"expand_goals"|"final_answer",
  "skillsToLoad": ["skill-name"],
  "action": "<tool_name when mode is use_tool, or optional check script on final_answer>",
  "query": "search query",
  "memoryKey": "optional",
  "memoryContent": "optional",
  "memoryType": "fact"|"observation"|"plan"|"result"|"other",
  "message": "optional chat text",
  "code": "optional script source",
  "scriptType": "node"|"python",
  "fileName": "script.py or script.js matching scriptType",
  "reason": "short why"
}

Rules:
- Prefer mode=use_tool until acceptanceChecks are met; then final_answer.
- mode=final_answer when evidence may already be enough; include action+code only if a short verify/check script is needed.
- mode=expand_goals only if the expansion/sub-goals clearly cannot produce the deliverable.
- Honor suggestedApproach / suggestedTools when sensible.
- If requiresShell and a file is expected, use execute_script (or list_workspace_files). Print absolute paths.
- If requiresPersonalData, search domains before final_answer; do not invent personal facts.
- Honor budget: do not final_answer before minsMet unless maxExceeded/nearMax.
- Never call Answer Machine.`;

    const userPrompt = JSON.stringify(
        {
            currentGoal: { title: goalTitle, description: goalDescription },
            goalExpansion: goalExpansion || null,
            childResultsPack: childResultsPack || null,
            tickNumber,
            recentNoopCount,
            budget: budgetContext || null,
            memory: memorySummary,
            recentToolResults: recentToolSummary,
            instruction:
                recentNoopCount >= 2
                    ? 'Too many noops. Prefer the most direct tool, or final_answer if acceptanceChecks are met.'
                    : 'Follow goalExpansion. Choose one brain mode (use_tool|expand_goals|final_answer).',
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
    const expansionSkills = Array.isArray(goalExpansion?.suggestedSkills)
        ? (goalExpansion!.suggestedSkills as string[]).filter((s) => typeof s === 'string')
        : [];
    const mergedSkills = Array.from(new Set([...(skillsToLoad || []), ...expansionSkills])).slice(
        0,
        3
    );

    if (!json) {
        return {
            kind: 'use_tool',
            mode: 'use_tool',
            action: defaultAction,
            query: goalTitle || goalDescription,
            reason: 'Planner JSON parse failed; using expansion default action',
            skillsToLoad: mergedSkills,
            scriptType: requiresShell ? 'python' : undefined,
            fileName: requiresShell ? 'create_artifact.py' : undefined,
        };
    }

    const modeRaw = typeof json.mode === 'string' ? json.mode.trim() : '';
    const reason = typeof json.reason === 'string' ? json.reason : '';

    const mode: AgentBrainDecisionMode =
        modeRaw === 'use_tool' || modeRaw === 'expand_goals' || modeRaw === 'final_answer'
            ? modeRaw
            : 'use_tool';

    if (mode === 'final_answer') {
        const optionalAction =
            typeof json.action === 'string' && json.action.trim() ? json.action.trim() : undefined;
        return {
            kind: 'final_answer',
            mode: 'final_answer',
            reason: reason || 'Enough evidence to answer',
            skillsToLoad: mergedSkills,
            action: optionalAction,
            query: typeof json.query === 'string' ? json.query : undefined,
            code: typeof json.code === 'string' ? json.code : undefined,
            scriptType: typeof json.scriptType === 'string' ? json.scriptType : undefined,
            fileName: typeof json.fileName === 'string' ? json.fileName : undefined,
        };
    }
    if (mode === 'expand_goals') {
        return {
            kind: 'expand_goals',
            mode: 'expand_goals',
            reason: reason || 'Plan needs revision',
            skillsToLoad: mergedSkills,
        };
    }

    let action = typeof json.action === 'string' && json.action.trim() ? json.action.trim() : defaultAction;
    if (
        requiresShell &&
        /^search_(notes|tasks|memo|life_events|info_vault|all_domains)$/i.test(action) &&
        !requiresPersonalData
    ) {
        action = 'execute_script';
    }

    return {
        kind: 'use_tool',
        mode: 'use_tool',
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
        scriptType:
            typeof json.scriptType === 'string' ? json.scriptType : requiresShell ? 'python' : undefined,
        fileName: typeof json.fileName === 'string' ? json.fileName : undefined,
        reason,
        skillsToLoad: mergedSkills,
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
    goalExpansion?: Record<string, unknown> | null;
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
        goalExpansion,
    } = params;

    const expectsFile = goalExpansion?.requiresShell === true;
    const requiresPersonalData = goalExpansion?.requiresPersonalData === true;

    const messages: Message[] = [
        {
            role: 'system',
            content:
                'You verify one agent tool step against the goal expansion. Reply JSON ONLY:\n' +
                '{\n' +
                '  "verdict":"continue"|"ready_to_synthesize"|"retry",\n' +
                '  "reason":"max 200 chars",\n' +
                '  "retryHint":"optional",\n' +
                '  "sourcesSeen":["notes"|"tasks"|"memo"|"lifeEvents"|"infoVault"],\n' +
                '  "evidenceGaps":["short gap"],\n' +
                '  "suggestedNextAction":"tool name",\n' +
                '  "suggestedQuery":"focused next query",\n' +
                '  "researchBrief":"short grounded findings"\n' +
                '}\n' +
                '- ready_to_synthesize if acceptanceChecks / successCriteria look met from lastResult + memory.\n' +
                (expectsFile
                    ? '- File deliverable: if memory/tool output already shows a real .xlsx/.pdf/etc path (or list_workspace_files shows it), use ready_to_synthesize. Do NOT keep looping on pandas/openpyxl verification scripts or venv installs once the file exists.\n'
                    : '') +
                (requiresPersonalData
                    ? '- Personal data: once 2+ domains appear in memory (or several searches already ran), use ready_to_synthesize. Do NOT keep searching for every missing detail forever — synthesize grounded advice and mark gaps.\n'
                    : '') +
                '- continue: more work needed.\n' +
                '- retry: last action failed; set retryHint.\n' +
                'Honor budget mins/max.\n' +
                (activeSkillsBlock ? `\n${activeSkillsBlock}` : ''),
        },
        {
            role: 'user',
            content: JSON.stringify(
                {
                    goal: { title: goalTitle, description: goalDescription },
                    goalExpansion: goalExpansion || null,
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
    goalExpansion?: Record<string, unknown> | null;
    childResultsPack?: string;
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
        goalExpansion,
        childResultsPack,
    } = params;

    const expectsFile = goalExpansion?.requiresShell === true;
    const artifact = detectArtifactEvidence(
        memorySummary
            .split('\n')
            .filter(Boolean)
            .map((line, i) => ({ key: `mem_${i}`, content: line })),
        memorySummary
    );

    const messages: Message[] = [
        {
            role: 'system',
            content:
                'You write the FINAL ANSWER for an autonomous agent.\n' +
                'Follow the goal expansion outputFormat and successCriteria.\n' +
                (expectsFile
                    ? 'Include exact filename and absolute workspace path from evidence. Do not invent paths. If missing, say the file was not created.\n'
                    : 'Citation-first when personal evidence exists; mark speculation clearly.\n') +
                'Be practical and structured. Plain text only.\n' +
                (activeSkillsBlock ? `\n${activeSkillsBlock}` : ''),
        },
        {
            role: 'user',
            content: [
                `GOAL TITLE:\n${goalTitle}`,
                `GOAL / USER REQUEST:\n${goalDescription}`,
                goalExpansion
                    ? `GOAL EXPANSION:\n${JSON.stringify(goalExpansion, null, 2)}`
                    : '',
                childResultsPack ? `CHILD RESULTS PACK:\n${childResultsPack}` : '',
                pastChatSummary ? `RECENT CHAT:\n${pastChatSummary}` : '',
                `EVIDENCE / MEMORY:\n${memorySummary || '(none)'}`,
                expectsFile && artifact.paths.length
                    ? `DETECTED ARTIFACT PATHS:\n${artifact.paths.join('\n')}`
                    : '',
                budgetContext
                    ? `BUDGET STATUS:\n${JSON.stringify(budgetContext, null, 2)}`
                    : '',
                'Write the final answer now.',
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
