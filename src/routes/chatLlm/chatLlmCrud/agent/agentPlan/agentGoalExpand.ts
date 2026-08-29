import mongoose from 'mongoose';

import { ModelAgentGoal } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentGoalExpansion } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoalExpansion.schema';
import { IAgentGoal } from '../../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentGoal.types';
import { IAgentGoalExpansion } from '../../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentGoalExpansion.types';
import { Message } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../../chatUtils/chatLlmGetLlmConfig';
import writeAgentLog, { fetchLlmUnifiedLogged, type AgentLogContext } from '../agentUtils/agentWriteLog';
import { loadContextChatWindow, withContextChatMessages } from '../agentUtils/agentContextWindow';
import { dropMicroStepGoalSeeds, isPrintMetadataOnlyGoal } from './agentGoalSeedFilter';

export type GoalExpansionSnapshot = {
    outputFormat: string;
    expectations: string[];
    successCriteria: string;
    suggestedApproach: string;
    suggestedSkills: string[];
    suggestedTools: string[];
    requiresShell: boolean;
    requiresPersonalData: boolean;
    acceptanceChecks: string[];
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
        /* try slice */
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

const asStringArray = (v: unknown, max: number): string[] => {
    if (!Array.isArray(v)) return [];
    return v
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, max);
};

const defaultExpansionForGoal = (goal: {
    title: string;
    description: string;
}): GoalExpansionSnapshot => ({
    outputFormat: 'text_answer',
    expectations: [`Complete: ${goal.title}`],
    successCriteria: `User request addressed: ${goal.description || goal.title}`.slice(0, 500),
    suggestedApproach: 'Understand the goal, use the most direct tools available, verify success criteria.',
    suggestedSkills: [],
    suggestedTools: [],
    requiresShell: false,
    requiresPersonalData: false,
    acceptanceChecks: ['Final answer matches the stated success criteria'],
});

const normalizeExpansion = (
    raw: Record<string, unknown> | null,
    fallback: GoalExpansionSnapshot
): GoalExpansionSnapshot => {
    if (!raw) return fallback;
    return {
        outputFormat:
            typeof raw.outputFormat === 'string' && raw.outputFormat.trim()
                ? raw.outputFormat.trim().slice(0, 120)
                : fallback.outputFormat,
        expectations: asStringArray(raw.expectations, 12).length
            ? asStringArray(raw.expectations, 12)
            : fallback.expectations,
        successCriteria:
            typeof raw.successCriteria === 'string' && raw.successCriteria.trim()
                ? raw.successCriteria.trim().slice(0, 800)
                : fallback.successCriteria,
        suggestedApproach:
            typeof raw.suggestedApproach === 'string' && raw.suggestedApproach.trim()
                ? raw.suggestedApproach.trim().slice(0, 1200)
                : fallback.suggestedApproach,
        suggestedSkills: asStringArray(raw.suggestedSkills, 6),
        suggestedTools: asStringArray(raw.suggestedTools, 8),
        requiresShell: raw.requiresShell === true,
        requiresPersonalData: raw.requiresPersonalData === true,
        acceptanceChecks: asStringArray(raw.acceptanceChecks, 12).length
            ? asStringArray(raw.acceptanceChecks, 12)
            : fallback.acceptanceChecks,
    };
};

type SubGoalSeed = { title: string; description: string };

const normalizeTitleKey = (s: string): string =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');

const parseSubGoals = (
    raw: unknown,
    parent: { title: string; description: string }
): SubGoalSeed[] => {
    if (!Array.isArray(raw)) return [];
    const out: SubGoalSeed[] = [];
    const seen = new Set<string>();
    const parentKey = normalizeTitleKey(parent.title);
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const title = String(o.title || o.description || '').trim();
        const description = String(o.description || o.title || '').trim();
        if (!title) continue;
        if (isPrintMetadataOnlyGoal(title, description)) continue;
        const key = normalizeTitleKey(title);
        if (!key || key === parentKey || seen.has(key)) continue;
        // Drop near-duplicates that only differ by filler words
        const alreadySimilar = [...seen].some(
            (s) => s.includes(key) || key.includes(s)
        );
        if (alreadySimilar) continue;
        seen.add(key);
        out.push({
            title: title.slice(0, 200),
            description: (description || title).slice(0, 2000),
        });
    }
    const filtered = dropMicroStepGoalSeeds(out);
    // One leftover child is the whole task — run the parent as a one-shot.
    if (filtered.length < 2) return [];
    return filtered;
};

/**
 * LLM-expand a goal: output format, expectations, approach, and optional sub-goals.
 * Persists expansion doc; creates child AgentGoal rows when subGoals are returned.
 */
export const expandAndPersistAgentGoal = async (params: {
    logCtx: AgentLogContext;
    goal: IAgentGoal;
    userRequest: string;
    /** Extra context gathered during plan probes (shell tests, listings, notes). */
    planContext?: string;
    /** When false, never create child goals (depth-1 leaf expand). Default true for tops. */
    allowSubGoals?: boolean;
    /** Replace pending children when re-planning. Default false. */
    replacePendingChildren?: boolean;
}): Promise<{ expansion: IAgentGoalExpansion; subGoals: IAgentGoal[] }> => {
    const {
        logCtx,
        goal,
        userRequest,
        planContext,
        allowSubGoals = true,
        replacePendingChildren = false,
    } = params;
    const fallback = defaultExpansionForGoal(goal);
    const llmConfig = await getLlmConfig({ threadId: goal.threadId });

    let expansionData = fallback;
    let subGoalSeeds: SubGoalSeed[] = [];

    if (llmConfig) {
        const chatWindow = await loadContextChatWindow({
            threadId: goal.threadId as mongoose.Types.ObjectId,
            agentInstanceId: logCtx.agentInstanceId,
            userId: logCtx.userId,
            logCtx,
        });
        const messages: Message[] = withContextChatMessages(
            {
                role: 'system',
                content: `You are a senior planner. You divide tasks so the vast majority complete reliably via small, verifiable steps. Do NOT hardcode categories; infer from the goal text.
Use PLAN CONTEXT (probe/test results) when present — prefer concrete findings over guesses.
Return JSON ONLY:
{
  "outputFormat": "short label of deliverable (e.g. text_answer, pdf_file, excel_file, image_file, workspace_file, chat_update)",
  "expectations": ["concrete expected outcomes"],
  "successCriteria": "when is this goal done?",
  "suggestedApproach": "how the agent should solve it (tools/skills in natural language)",
  "suggestedSkills": ["optional skill names from catalog if useful"],
  "suggestedTools": ["optional tool names e.g. execute_script, image_to_text, search_all_domains, list_workspace_files"],
  "requiresShell": boolean,
  "requiresPersonalData": boolean,
  "acceptanceChecks": ["verify checklist items before ready_to_synthesize"],
  "subGoals": [{"title":"...","description":"..."}]
}
Decomposition (harness-style, generic inference — do NOT hardcode file-type or domain categories):
- For the vast majority of tasks, prefer 3-5 sequential subGoals, each independently executable in 1-2 tool calls and verifiable via acceptanceChecks. Only return [] when the goal is truly trivial (single chat answer, no persistent artifact, no multi-step logic). Infer subGoals solely from the goal text + planContext — do not use hardcoded file-type lists.
- Each subGoal: short title, description = full success criteria including what artifact/state proves completion and which tool validates it. Order is dependency order — early output is later input. No overlapping work, no duplicate titles. Infer required tools/skills from goal semantics (e.g. creation → execute_script, understanding image text → image_to_text, synthesis → search), not from a fixed mapping.
- Generic harness shape (infer and adapt, never force): analyze inputs → implement core → verify/polish → finalize. Derive steps from goal: if goal implies exploring workspace/data, include a discover step; if goal implies a persistent artifact, include an implement step and a verify step that checks existence/size/format and prints a grounded path; if goal implies synthesis across personal history, split research by implicit domain and then synthesize. For multi-deliverable goals, one subGoal per deliverable plus a final verify.
- Large tasks MUST be divided into multiple small tasks based on requirement due to context length limits; each small task is solved and tested before moving to the next, like a human with limited working memory. Do not attempt a large task in one big context/script. Each small task's acceptanceChecks must include an explicit test/verification inferred from its requirement that proves the step succeeded before the next step begins. This keeps the context window compact and mimics human iterative solving. Applies to all large tasks, not only file/terminal access — infer division points from the requirement itself.
- Rules (all generic inference, no hardcoding):
- Infer requiresShell from goal: true when goal implies creating/editing a persistent artifact that must be verified on disk; false otherwise. Infer outputFormat from expected deliverable semantics (infer label from goal, e.g. workspace_file vs chat_update), not from a hardcoded extension list. When Done-when implies workspace outputs must be printed, treat that as workspace_file.
- Infer requiresPersonalData from goal: true when answer must be grounded in the user's own notes/tasks/history; then prefer research-oriented tools.
- Infer suggestedSkills/suggestedTools from goal semantics and available catalog — suggest only when clearly useful, do not hardcode skill name lists.
- Never create a separate "Report file metadata" subGoal — printing path/size is part of the same implementation step that creates the artifact.
- Never create a "locate/find the uploaded file" subGoal when fixtures are already listed in planContext/userRequest. Prefer list_workspace_files only for truly unknown locations inferred from goal; never assume \`find /\` is needed.
- Keep subGoals lean: 3-5 max, each verifiable. Merge read+write when it does not hide verification; prefer a distinct verify step after the main create for reliability, inferred from goal.
- ${allowSubGoals ? 'You MAY and SHOULD return 3-5 subGoals for most tasks by inferring from goal; return [] only for trivial single-turn chat answers.' : 'You MUST return subGoals: []. Do not split this goal further.'}`,
            },
            chatWindow,
            {
                role: 'user',
                content: JSON.stringify(
                    {
                        userRequest: userRequest.slice(0, 4000),
                        goal: { title: goal.title, description: goal.description },
                        planContext: (planContext || '').slice(0, 8000) || null,
                        allowSubGoals,
                    },
                    null,
                    2
                ),
            }
        );

        try {
            const llmResult = await fetchLlmUnifiedLogged({
                logCtx,
                purpose: 'agent_goal_expand',
                params: {
                    provider: llmConfig.provider,
                    apiKey: llmConfig.apiKey,
                    apiEndpoint: llmConfig.apiEndpoint,
                    model: llmConfig.model,
                    messages,
                    temperature: 0.25,
                    maxTokens: 2800,
                    responseFormat: 'json_object',
                    headersExtra: llmConfig.customHeaders,
                },
            });
            const json = extractJsonObject(llmResult.content || '');
            expansionData = normalizeExpansion(json, fallback);
            if (allowSubGoals) {
                subGoalSeeds = parseSubGoals(json?.subGoals, goal);
            }
        } catch (e) {
            console.error('expandAndPersistAgentGoal LLM failed:', e);
            await writeAgentLog({
                ...logCtx,
                action: 'goal_expand_error',
                message: e instanceof Error ? e.message : String(e),
                level: 'warn',
                goalId: goal._id as mongoose.Types.ObjectId,
            });
        }
    }

    const now = new Date();
    const expansion = await ModelAgentGoalExpansion.findOneAndUpdate(
        { agentGoalId: goal._id },
        {
            $set: {
                agentInstanceId: goal.agentInstanceId,
                agentGoalId: goal._id,
                userId: goal.userId,
                threadId: goal.threadId,
                ...expansionData,
                updatedAtUtc: now,
            },
            $setOnInsert: { createdAtUtc: now },
        },
        { upsert: true, new: true }
    );

    if (replacePendingChildren) {
        await ModelAgentGoal.deleteMany({
            agentInstanceId: goal.agentInstanceId,
            parentGoalId: goal._id,
            status: { $in: ['pending', 'in_progress'] },
        });
    }

    const subGoals: IAgentGoal[] = [];
    if (allowSubGoals && subGoalSeeds.length > 0) {
        const existingChildren = await ModelAgentGoal.countDocuments({
            agentInstanceId: goal.agentInstanceId,
            parentGoalId: goal._id,
        });
        // Only create children when none exist yet (or we just replaced pending ones)
        if (existingChildren === 0 || replacePendingChildren) {
            const docs = subGoalSeeds.map((s, i) => ({
                agentInstanceId: goal.agentInstanceId,
                userId: goal.userId,
                threadId: goal.threadId,
                parentGoalId: goal._id as mongoose.Types.ObjectId,
                orderIndex: i,
                title: s.title,
                description: s.description,
                status: 'pending' as const,
                result: '',
                createdAtUtc: now,
                updatedAtUtc: now,
                completedAtUtc: null,
            }));
            const inserted = await ModelAgentGoal.insertMany(docs);
            for (const g of inserted) {
                subGoals.push(g as unknown as IAgentGoal);
            }
            // Parent waits on children — keep pending until children finish
            goal.status = 'pending';
            goal.updatedAtUtc = now;
            await goal.save();
        }
    }

    await writeAgentLog({
        ...logCtx,
        action: 'goal_expanded',
        title: `Expanded goal: ${goal.title}`,
        message: `outputFormat=${expansionData.outputFormat}; subGoals=${subGoals.length}`,
        goalId: goal._id as mongoose.Types.ObjectId,
        payload: {
            outputFormat: expansionData.outputFormat,
            requiresShell: expansionData.requiresShell,
            requiresPersonalData: expansionData.requiresPersonalData,
            expectations: expansionData.expectations,
            subGoalTitles: subGoals.map((g) => g.title),
            allowSubGoals,
        },
    });

    return { expansion, subGoals };
};

export const loadGoalExpansion = async (
    goalId: mongoose.Types.ObjectId | string
): Promise<IAgentGoalExpansion | null> => {
    return ModelAgentGoalExpansion.findOne({ agentGoalId: goalId });
};

export const formatExpansionForPrompt = (
    expansion: GoalExpansionSnapshot | IAgentGoalExpansion | null | undefined
): Record<string, unknown> | null => {
    if (!expansion) return null;
    return {
        outputFormat: expansion.outputFormat,
        expectations: expansion.expectations,
        successCriteria: expansion.successCriteria,
        suggestedApproach: expansion.suggestedApproach,
        suggestedSkills: expansion.suggestedSkills,
        suggestedTools: expansion.suggestedTools,
        requiresShell: expansion.requiresShell,
        requiresPersonalData: expansion.requiresPersonalData,
        acceptanceChecks: expansion.acceptanceChecks,
    };
};

/** True when expansion says a workspace file deliverable is expected (LLM-set flags only). */
export const expansionExpectsWorkspaceFile = (
    expansion: GoalExpansionSnapshot | IAgentGoalExpansion | null | undefined,
    extraBlob?: string
): boolean => {
    if (!expansion && !extraBlob) return false;
    const format = String((expansion as { outputFormat?: string } | null)?.outputFormat || '').toLowerCase();
    const blob = [
        format,
        String((expansion as { successCriteria?: string } | null)?.successCriteria || ''),
        String((expansion as { suggestedApproach?: string } | null)?.suggestedApproach || ''),
        ...((((expansion as { expectations?: string[] } | null)?.expectations || []) as string[])),
        ...((((expansion as { acceptanceChecks?: string[] } | null)?.acceptanceChecks || []) as string[])),
        extraBlob || '',
    ]
        .join('\n')
        .toLowerCase();
    if (/\b(workspace_file|pdf_file|excel_file|image_file)\b/.test(format)) return true;
    // Named output / in-place edit (input.b64, doc.txt) beats a wrong chat_update label.
    const namedOut =
        /\b(into|to|named)\s+['"`]?[\w.-]+\.[a-z0-9]{1,12}\b/i.test(blob) ||
        /\b[\w.-]+\.[a-z0-9]{1,12}\b.{0,40}(created|exists in the workspace|is modified)/i.test(blob) ||
        /\b(replace|append|edit|overwrite|in-place).{0,60}[\w.-]+\.[a-z0-9]{1,12}\b/i.test(blob);
    if (
        namedOut &&
        /\b(create|created|write|written|save|saved|generate|generated|convert|produce|encode|encoded|replace|modified)\b/.test(
            blob
        )
    ) {
        return true;
    }
    // Implement a CLI/module/script *file* even if labeled chat_update.
    // "Use a script to generate passwords" is a tool, not a workspace-file product.
    const usesScriptAsTool = /\buse (a |the )?(script|python3?|node(?:\.js)?)\b/.test(blob);
    if (
        !usesScriptAsTool &&
        /\b(create|write|implement|generate)\b/.test(blob) &&
        /\b(cli|command-line|--input|--output|script|\.py|\.js|module|middleware)\b/.test(blob)
    ) {
        return true;
    }
    // Convert/export to a concrete format still needs a file, even if labeled chat_update.
    if (
        /\b(convert|render|export|transform)\b/.test(blob) &&
        /\b(html|pdf|csv|tsv|json|xlsx|ics|png|file|\.html|\.pdf|\.csv|\.json)\b/.test(blob)
    ) {
        return true;
    }
    // "Workspace outputs" / print path+size of created files — chat-only is not done.
    if (
        /\b(workspace outputs|created files|print absolute paths?)\b/.test(blob) ||
        (/\babsolute paths?\b/.test(blob) && /\b(file size|sizes? of)\b/.test(blob))
    ) {
        return true;
    }
    // Pure chat/text answers may use the shell to inspect, but do not require a new file.
    if (format === 'chat_update' || format === 'text_answer') return false;
    if (
        /\b(create|created|write|written|save|saved|generate|generated|merge|convert|produce|encode|encoded)\b/.test(
            blob
        ) &&
        (/\b(file|\.txt|\.csv|\.tsv|\.json|\.md|\.pdf|\.xlsx|\.png|\.zip|\.ics|\.html|\.js)\b/.test(blob) ||
            /\b[\w.-]+\.[a-z0-9]{1,12}\b/.test(blob))
    ) {
        return true;
    }
    return Boolean(expansion && expansion.requiresShell === true);
};

/** Build a concise child-results pack for parent goal context. */
export const formatChildResultsPack = (
    children: Array<{
        _id: mongoose.Types.ObjectId | string;
        title: string;
        description?: string;
        status: string;
        result?: string;
    }>
): string => {
    if (!children.length) return '';
    return children
        .map((c, i) => {
            const result = (c.result || '').trim();
            return [
                `### Sub-goal ${i + 1}: ${c.title} [${c.status}]`,
                c.description ? `Request: ${c.description.slice(0, 500)}` : '',
                result ? `Result:\n${result.slice(0, 4000)}` : 'Result: (empty)',
            ]
                .filter(Boolean)
                .join('\n');
        })
        .join('\n\n')
        .slice(0, 12000);
};
