import { Message } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { fetchLlmUnifiedStream } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../../chatUtils/chatLlmGetLlmConfig';
import writeAgentLog, { fetchLlmUnifiedLogged, AgentLogContext } from '../agentUtils/agentWriteLog';
import { AGENT_SHELL_ENV_BLURB } from '../agentUtils/agentShell/agentShellEnvironmentContext';
import {
    AGENT_WORKSPACE_CONTAINER_STORAGE,
} from '../../../../../utils/agentWorkspace/agentWorkspacePaths';
import {
    isAgentContextMemoryKey,
    withContextChatMessages,
    type AgentChatWindow,
} from '../agentUtils/agentContextWindow';
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
          relativePath?: string;
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
    // Require /config/... or ai-notes-xyz-agent-workspace/... (optional PDF_PATH= prefix).
    const pathRe =
        /(?:(?:PDF|XLSX|FILE|OUT)_PATH=)?(?:\/config\/|ai-notes-xyz-agent-workspace\/)[^\s"'`<>|]{3,400}\.([a-z0-9]{1,12})/gi;
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
    /\.(pdf|xlsx|xls|csv|tsv|png|jpe?g|webp|gif|zip|docx|txt|md|eml|html|json|ics|js|mjs|cjs|ts|py|sql|ya?ml|mmd|db|sqlite3?)$/i;

/** Well-known files with no extension (Makefile, Dockerfile, …). */
const EXTENSIONLESS_DELIVERABLE_RE =
    /^(makefile|dockerfile|procfile|gemfile|rakefile|license|copying|cmakelists\.txt|\.env(?:\.example)?|\.gitignore)$/i;

/** Helper / probe scripts the agent writes — never count these as the user deliverable. */
const HELPER_SCRIPT_NAME_RE =
    /^(script_\d+|create_artifact|create_[a-z0-9_-]+\.(?:py|js|mjs|cjs|ts)$|plan_probe|tmp_|read_|analyze_|inspect_|debug_|probe_|check_|verify_|count_|process_|convert_|sort_|append_|validate_|identify_|final_|list_|cat_|find_|search_|scan_|locate_|walk_|discover_|investigate_|discovery_|encode_|decode_|replace_|generate_|parse_)|_check\.(?:py|js|mjs|cjs|ts)$/i;

/** Tool stdout that proves a file was written (OUT=/SIZE= plus common print shapes). */
const TOOL_PRINTED_META_RE =
    /OUT\s*=|SIZE\s*[:=]|SIZE_?BYTES?\s*[:=]|FILE[_ ]?(?:CREATED|SIZE)|File created|absolute path|\d+\s*bytes\b|appended|updated|wrote|written|saved (to|successfully)|output saved/i;

const parsePrintedFileSize = (summary: string): number => {
    const m =
        String(summary || '').match(/SIZE(?:_?BYTES?)?\s*[:=]\s*(\d+)/i) ||
        String(summary || '').match(/FILE_SIZE\s*[:=]\s*(\d+)/i) ||
        String(summary || '').match(/Size:\s*(\d+)\s*bytes/i) ||
        String(summary || '').match(/(\d+)\s*bytes\b/i);
    const n = m ? Number(m[1]) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Infer expected output extensions from goal expansion / title / description.
 * Empty array = any non-helper deliverable is acceptable.
 */
export const inferExpectedDeliverableExts = (params: {
    title?: string;
    description?: string;
    acceptanceChecks?: string[];
    expectations?: string[];
    outputFormat?: string;
    suggestedApproach?: string;
}): string[] => {
    const blob = [
        params.title || '',
        params.description || '',
        params.outputFormat || '',
        params.suggestedApproach || '',
        ...(params.acceptanceChecks || []),
        ...(params.expectations || []),
    ]
        .join('\n')
        .toLowerCase();

    const found = new Set<string>();
    const add = (ext: string) => found.add(ext.replace(/^\./, '').toLowerCase());

    // Count/list/report-over-inputs: ".md files in this tree" are inputs, not the deliverable.
    // Returning [] lets any new non-helper file (or chat answer) stop the loop.
    const isInputScanOnly =
        /\b(count|how many|list|enumerate|search for)\b/.test(blob) &&
        !/\b(create|write|save|generate|convert|build|produce|merge|export|render|replace|substitute)\b/.test(
            blob
        );
    if (isInputScanOnly) {
        return [];
    }

    // Standalone type mentions (".json", "save as .ics") — not the ext inside input names like fields.txt.
    const standaloneType = blob.matchAll(
        /(?:^|[\s'"(`[])\.(pdf|xlsx|xls|csv|tsv|png|jpe?g|webp|gif|zip|docx|txt|md|eml|html|json|ics|js|mjs|cjs|ts|sql|ya?ml|mmd)\b/gi
    );
    for (const m of standaloneType) add(m[1]);
    // Named outputs / in-place edit targets (including uncommon exts like input.b64).
    for (const m of blob.matchAll(/\b([a-z0-9][\w.-]*\.([a-z0-9]{1,12}))\b/gi)) {
        const name = String(m[1] || '');
        const ext = String(m[2] || '').toLowerCase();
        if (!ext || /^(pyc|pyo|class|lock|map|tmp|git|log|example|env)$/.test(ext)) continue;
        if (HELPER_SCRIPT_NAME_RE.test(name)) continue;
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const asOutput = new RegExp(
            `(?:into|to|named|create|write|save|generate|output)\\s+['"\`]?${esc}\\b|\\b${esc}\\b.{0,40}(?:created|exists)\\b`,
            'i'
        );
        const asInPlace = new RegExp(
            `(?:replace|append|edit|overwrite|trim|modify|in-place).{0,60}${esc}|${esc}.{0,60}(?:replace|append|modified|in-place)`,
            'i'
        );
        if (asOutput.test(blob) || asInPlace.test(blob)) add(ext);
    }

    if (/\bics\b|icalendar|calendar invite|meeting\.ics/i.test(blob)) add('ics');
    if (/\bpdf\b/i.test(blob)) add('pdf');
    if (/\bxlsx\b|excel/i.test(blob)) add('xlsx');
    if (/\bjson\b/i.test(blob) && /\b(write|create|save|generate|output|file|object|document)\b/i.test(blob)) {
        add('json');
    }
    if (/\bhtml\b/i.test(blob) && /\b(convert|write|create|save|generate|output|file|render)\b/i.test(blob)) {
        add('html');
    }
    if (/\btsv\b/i.test(blob) || (/tabs?\b/i.test(blob) && /csv|comma/i.test(blob))) add('tsv');
    if (/\bzip\b|password-protected zip|archive/i.test(blob)) add('zip');
    if (
        /\bsqlite3?\b/.test(blob) ||
        (/\b(database|\.db|\.sqlite)\b/.test(blob) &&
            /\b(create|seed|insert|populate|import)\b/.test(blob))
    ) {
        add('db');
        add('sqlite');
        add('sqlite3');
    }
    if (
        /\bgrayscale|resize|rotate|watermark|screenshot|compress.*image/i.test(blob)
    ) {
        add('png');
        add('jpg');
        add('jpeg');
        add('webp');
    }
    // Sum/count/average of a file with no named output — a .txt result is the deliverable.
    if (
        found.size === 0 &&
        /\b(sum|total|count|average|calculate|compute)\b/.test(blob) &&
        !/\b(personal-research|search_all_domains)\b/.test(blob)
    ) {
        add('txt');
    }
    // Implement JS/TS — not merely mentioning "Node.js" (e.g. a .gitignore for Node).
    if (
        /\bttl cache|in-memory cache|shared module|refactor|middleware|express|flask|fastify/i.test(blob) ||
        /\bget\s+\/[a-z0-9]/i.test(blob) ||
        /\b(endpoint|http server|web server|rest[\s-]?api)\b/i.test(blob) ||
        (/\b(javascript|typescript)\b/.test(blob) &&
            /\b(script|module|file|implement|write|create|build)\b/.test(blob)) ||
        (/\bnode(?:\.js|js)?\b/.test(blob) &&
            /\b(script|module|server|app|implement|express)\b/.test(blob))
    ) {
        add('js');
        add('mjs');
    }

    return [...found];
};

/** HTTP/API implement goals need a real .js/.py module — a JSON dump is not enough. */
export const goalRequiresCodeDeliverable = (blob: string): boolean => {
    const t = String(blob || '').toLowerCase();
    return (
        /\b(express|flask|fastify|koa|middleware)\b/.test(t) ||
        /\bget\s+\/[a-z0-9]/.test(t) ||
        /\b(endpoint|http server|web server|rest[\s-]?api|createserver)\b/.test(t) ||
        /\bserve\b.{0,80}\b(get\b|\/[a-z]|users\b|api\b)/.test(t)
    );
};

const DATABASE_FILE_RE = /\.(db|sqlite3?)$/i;

/** SQLite/create-DB goals need a real .db/.sqlite on disk — a converter script is not enough. */
export const goalRequiresDatabaseDeliverable = (blob: string): boolean => {
    const t = String(blob || '').toLowerCase();
    return (
        /\bsqlite3?\b/.test(t) ||
        (/\b(database|\.db|\.sqlite)\b/.test(t) &&
            /\b(create|seed|insert|populate|import)\b/.test(t))
    );
};

/**
 * Non-venv workspace files that look like user deliverables (size > 0).
 * Used to stop endless "verify with pandas" loops once the file exists.
 * Fixture inputs are excluded via workspace baseline (not by skipping uploads/).
 * Helper scripts (read_*.py, create_artifact.*, analyze_*) never count.
 * When expectedExts is set, ONLY matching extensions count (prevents read_meeting.py
 * counting as success for an .ics goal).
 */
export const listWorkspaceDeliverables = (
    listing: Array<{
        relativePath: string;
        pathInAgentFolder?: string;
        absolutePath?: string;
        isDir?: boolean;
        size?: number;
    }>,
    opts?: { expectedExts?: string[] }
): Array<{ relativePath: string; pathInAgentFolder: string; absolutePath: string; size: number }> => {
    const expectedExts = (opts?.expectedExts || [])
        .map((e) => e.replace(/^\./, '').toLowerCase())
        .filter(Boolean);
    // JS/TS are interchangeable. Do not treat probe .py scripts as a Node/JWT/Express app.
    const JS_EXTS = ['js', 'mjs', 'cjs', 'ts'];
    if (expectedExts.some((e) => JS_EXTS.includes(e))) {
        for (const e of JS_EXTS) {
            if (!expectedExts.includes(e)) expectedExts.push(e);
        }
    }
    const out: Array<{
        relativePath: string;
        pathInAgentFolder: string;
        absolutePath: string;
        size: number;
    }> = [];
    for (const f of listing || []) {
        if (!f || f.isDir) continue;
        const rel = String(f.relativePath || '').replace(/\\/g, '/');
        if (!rel) continue;
        if (/\/venv\/|\/venv_|\.agent_venv\/|site-packages|__pycache__|\.dist-info\//i.test(rel)) {
            continue;
        }
        if (/\.(pyc|pyo|class|lock|map|tmp)$/i.test(rel)) continue;
        const pathInAgentFolder = String(f.pathInAgentFolder || rel.split('/').pop() || rel).replace(
            /\\/g,
            '/'
        );
        const baseName = pathInAgentFolder.split('/').pop() || pathInAgentFolder;
        if (HELPER_SCRIPT_NAME_RE.test(baseName)) continue;
        const knownExt = DELIVERABLE_EXT_RE.test(rel);
        const anyShortExt = /\.[a-z0-9]{1,12}$/i.test(baseName);
        const extensionlessOk = EXTENSIONLESS_DELIVERABLE_RE.test(baseName);
        if (!knownExt && !anyShortExt && !extensionlessOk) continue;
        if (expectedExts.length > 0) {
            const ok =
                expectedExts.some((e) => new RegExp(`\\.${e}$`, 'i').test(baseName)) ||
                extensionlessOk;
            if (!ok && knownExt) continue;
            if (!ok && !anyShortExt && !extensionlessOk) continue;
        }
        const size = typeof f.size === 'number' ? f.size : 0;
        if (size <= 0) continue;
        out.push({
            relativePath: rel,
            pathInAgentFolder,
            absolutePath: String(f.absolutePath || `${AGENT_WORKSPACE_CONTAINER_STORAGE}/${rel}`),
            size,
        });
    }
    return out;
};

export const listingHasDatabaseDeliverable = (
    listing: Parameters<typeof listWorkspaceDeliverables>[0]
): boolean =>
    listWorkspaceDeliverables(listing).some((d) =>
        DATABASE_FILE_RE.test(d.pathInAgentFolder.split('/').pop() || '')
    );

/** Listing can miss .db files; also accept stdout-merged / extra deliverable paths. */
export const hasDatabaseDeliverableEvidence = (
    listing: Parameters<typeof listWorkspaceDeliverables>[0],
    extraDeliverables?: Array<{ pathInAgentFolder?: string; relativePath?: string; absolutePath?: string }>
): boolean => {
    if (listingHasDatabaseDeliverable(listing)) return true;
    return (extraDeliverables || []).some((d) =>
        DATABASE_FILE_RE.test(
            String(d.pathInAgentFolder || d.relativePath || d.absolutePath || '')
                .replace(/\\/g, '/')
                .split('/')
                .pop() || ''
        )
    );
};

/** Filenames mentioned in the goal (e.g. doc.txt). */
export const namedFilesInGoalText = (blob: string): string[] => {
    const found = new Set<string>();
    for (const m of String(blob || '').matchAll(/(?:^|[^\w])(\.?[a-z0-9][\w.-]*\.[a-z0-9]{1,12})\b/gi)) {
        const n = String(m[1] || '').toLowerCase();
        if (n && !HELPER_SCRIPT_NAME_RE.test(n)) found.add(n);
    }
    return [...found];
};

/** Named files that are outputs or in-place edit targets — not mere inputs like app.log. */
export const namedOutputFilesInGoalText = (blob: string): string[] => {
    const text = String(blob || '');
    const out: string[] = [];
    for (const n of namedFilesInGoalText(text)) {
        const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const asOutput = new RegExp(
            `(?:into|to|named|create|write|save|generate|output)\\s+['"\`]?${esc}\\b|\\b${esc}\\b.{0,40}(?:created|exists)\\b`,
            'i'
        );
        const asInPlace = new RegExp(
            `(?:replace|append|edit|overwrite|trim|modify|in-place|add|implement|update|insert|patch|validation).{0,80}${esc}|${esc}.{0,60}(?:replace|append|modified|in-place|validation)`,
            'i'
        );
        if (asOutput.test(text) || asInPlace.test(text)) out.push(n);
    }
    return out;
};

/** True when this file’s size differs from the workspace baseline (in-place edit). */
export const fileSizeChangedFromBaseline = (
    pathInAgentFolder: string,
    size: number,
    sizesByName?: Map<string, number> | Record<string, number>
): boolean => {
    if (!sizesByName) return true;
    const name =
        String(pathInAgentFolder || '')
            .replace(/\\/g, '/')
            .toLowerCase()
            .split('/')
            .pop() || '';
    if (!name) return true;
    const baseSize =
        sizesByName instanceof Map ? sizesByName.get(name) : sizesByName[name];
    if (typeof baseSize !== 'number') return true;
    return size !== baseSize;
};

/** Named outputs that exist on disk but are empty (size 0) — not done yet. */
export const namedOutputsEmptyOnDisk = (
    listing: Array<{
        pathInAgentFolder?: string;
        relativePath?: string;
        isDir?: boolean;
        size?: number;
    }>,
    keepNamed?: Iterable<string>
): string[] => {
    const keep = new Set(
        [...(keepNamed || [])]
            .map((p) =>
                String(p || '')
                    .replace(/\\/g, '/')
                    .toLowerCase()
                    .split('/')
                    .pop()
            )
            .filter(Boolean)
    );
    if (!keep.size) return [];
    const empty: string[] = [];
    for (const f of listing || []) {
        if (!f || f.isDir) continue;
        const name = String(f.pathInAgentFolder || f.relativePath || '')
            .replace(/\\/g, '/')
            .split('/')
            .pop();
        if (!name || !keep.has(name.toLowerCase())) continue;
        if ((typeof f.size === 'number' ? f.size : 0) <= 0) empty.push(name);
    }
    return empty;
};

/** Keep new files, plus named in-place targets whose size changed vs the fixture. */
export const filterNewDeliverables = (
    deliverables: ReturnType<typeof listWorkspaceDeliverables>,
    baselinePaths: Iterable<string>,
    keepNamed?: Iterable<string>,
    baselineSizesByName?: Map<string, number> | Record<string, number>
): ReturnType<typeof listWorkspaceDeliverables> => {
    const base = new Set(
        [...baselinePaths].map((p) => String(p || '').replace(/\\/g, '/').toLowerCase())
    );
    const keep = new Set(
        [...(keepNamed || [])]
            .map((p) =>
                String(p || '')
                    .replace(/\\/g, '/')
                    .toLowerCase()
                    .split('/')
                    .pop()
            )
            .filter(Boolean)
    );
    if (base.size === 0) return deliverables;
    return deliverables.filter((d) => {
        const a = d.pathInAgentFolder.replace(/\\/g, '/').toLowerCase();
        const b = d.relativePath.replace(/\\/g, '/').toLowerCase();
        const name = a.split('/').pop() || '';
        if (keep.has(name)) {
            return fileSizeChangedFromBaseline(name, d.size, baselineSizesByName);
        }
        return !base.has(a) && !base.has(b) && !base.has(name);
    });
};

/**
 * When the shell listing is stale, still count grounded tool stdout paths
 * (`/config/...` or `ai-notes-xyz-agent-workspace/...` plus a printed size).
 * Helper scripts never count. Baseline fixtures are left to listing / in-place detection.
 */
export const mergeStdoutDeliverables = (params: {
    deliverables: ReturnType<typeof listWorkspaceDeliverables>;
    toolSummary?: string;
    baselinePaths?: Iterable<string>;
    expectedExts?: string[];
}): ReturnType<typeof listWorkspaceDeliverables> => {
    const existing = [...(params.deliverables || [])];
    const summary = String(params.toolSummary || '');
    if (!summary.trim()) return existing;
    if (/<\|tool_call|call:shell-environment:execute_script\{/i.test(summary)) return existing;

    const { paths } = detectArtifactEvidence([], summary);
    if (!paths.length) return existing;

    const expectedExts = (params.expectedExts || [])
        .map((e) => e.replace(/^\./, '').toLowerCase())
        .filter(Boolean);
    const have = new Set(
        existing.map((d) => (d.pathInAgentFolder.replace(/\\/g, '/').split('/').pop() || '').toLowerCase())
    );

    for (const p of paths) {
        const clean = p.replace(/^\/app\/data\//, '').replace(/\\/g, '/');
        const name = clean.split('/').pop() || '';
        if (!name || HELPER_SCRIPT_NAME_RE.test(name)) continue;
        if (have.has(name.toLowerCase())) continue;
        if (expectedExts.length > 0 && !expectedExts.some((e) => new RegExp(`\\.${e}$`, 'i').test(name))) {
            continue;
        }
        const size = parsePrintedFileSize(summary);
        if (size <= 0) continue;
        existing.push({
            relativePath: clean,
            pathInAgentFolder: name,
            absolutePath: p.startsWith('/') ? p : `${AGENT_WORKSPACE_CONTAINER_STORAGE}/${clean}`,
            size,
        });
        have.add(name.toLowerCase());
    }
    return existing;
};

/**
 * True when tool stdout shows a workspace file was written/updated (including baseline fixtures).
 * Prevents infinite loops on in-place edits (append, migrate, overwrite).
 */
export const toolTouchedWorkspaceFile = (params: {
    lastToolSummary?: string;
    listing: Array<{ pathInAgentFolder?: string; relativePath?: string; isDir?: boolean; size?: number }>;
    baselineSizesByName?: Map<string, number> | Record<string, number>;
}): boolean => {
    const summary = String(params.lastToolSummary || '');
    if (!summary.trim()) return false;
    if (/<\|tool_call|call:shell-environment:execute_script\{/i.test(summary)) return false;
    const printed = TOOL_PRINTED_META_RE.test(summary);
    if (!printed) return false;
    return (params.listing || []).some((f) => {
        if (!f || f.isDir) return false;
        const name = String(f.pathInAgentFolder || f.relativePath || '')
            .replace(/\\/g, '/')
            .split('/')
            .pop();
        if (!name || name.length < 2) return false;
        if (HELPER_SCRIPT_NAME_RE.test(name)) return false;
        if (!fileSizeChangedFromBaseline(name, f.size || 0, params.baselineSizesByName)) return false;
        return summary.includes(name) || new RegExp(name.replace(/\./g, '\\.'), 'i').test(summary);
    });
};

/**
 * Cheap evidence from tool stdout + deliverable names.
 * Basics only — LLM decides how to produce the file.
 */
export const toolEvidenceSupportsDeliverables = (params: {
    lastToolSummary?: string;
    deliverables: Array<{ pathInAgentFolder: string; size: number }>;
    expectedExts?: string[];
    acceptanceChecks?: string[];
}): { ok: boolean; reason: string } => {
    const summary = String(params.lastToolSummary || '');
    const dels = params.deliverables || [];
    if (!dels.length) {
        return { ok: false, reason: 'No matching deliverable on disk' };
    }
    if (/<\|tool_call|call:shell-environment:execute_script/i.test(summary)) {
        return { ok: false, reason: 'Unexecuted tool plan in transcript — run execute_script' };
    }
    const names = dels.map((d) => (d.pathInAgentFolder.split('/').pop() || d.pathInAgentFolder).toLowerCase());
    const mentioned = names.some((n) => summary.toLowerCase().includes(n));
    const printedMeta = TOOL_PRINTED_META_RE.test(summary);
    if (!summary.trim()) {
        if (dels.every((d) => d.size > 0)) {
            return { ok: true, reason: 'Deliverable on disk with size>0' };
        }
        return { ok: false, reason: 'Empty tool transcript and empty deliverable' };
    }
    if (!mentioned && !printedMeta) {
        return {
            ok: false,
            reason: 'Tool output does not reference the deliverable — print path/size then continue',
        };
    }
    return { ok: true, reason: 'Tool evidence supports deliverable' };
};

/** Synthesize/child results that are fake tool-call XML must not complete the goal. */
export const looksLikeUnexecutedToolPlan = (text: string): boolean =>
    /<\|tool_call|call:shell-environment:execute_script\{/i.test(String(text || ''));

/** Progress report / "I'll do it next" is not a finished deliverable. */
export const looksLikeIncompleteProgress = (text: string): boolean => {
    const t = String(text || '');
    if (!t.trim()) return false;
    if (
        /\bcould not fully synthesize|try sending the question again|no domain evidence was collected yet\b/i.test(
            t
        )
    ) {
        return true;
    }
    const progressy =
        /\b(next steps|ready to proceed|once (the )?(files?|api|stub|application|structure).{0,60}(located|found|identified)|prepared a search|i will (then|next|proceed)|as soon as .{0,40} (located|found))\b/i.test(
            t
        );
    const claimedDone = /\b(created|wrote|saved|implemented|renamed)\b/i.test(t);
    return progressy && !claimedDone;
};

/** Chat/text expansions: the answer belongs in the thread, not as a workspace file. */
export const isChatOrTextGoal = (outputFormat?: string | null): boolean => {
    const f = String(outputFormat || '').toLowerCase();
    return f === 'chat_update' || f === 'text_answer';
};

/**
 * Successful execute_script stdout that already contains the user-facing answer
 * (lists, generated values, counts). Used to stop chat-goal verify loops.
 */
export const toolOutputLooksLikeChatAnswer = (lastResultSummary: string): boolean => {
    const t = String(lastResultSummary || '');
    if (!t.trim()) return false;
    if (/<\|tool_call|call:shell-environment:execute_script\{/i.test(t)) return false;
    if (!/execute_script:\s*ok|script \S+ executed|successfully generated/i.test(t)) return false;
    const lines = t
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    return lines.length >= 4;
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
    // Do not trust LLM-mentioned /config/... paths alone (easy to hallucinate).
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
    /** Sliding window: last N actions + last M summaries + global summary. */
    contextPack?: string;
    chatMessages?: Message[] | AgentChatWindow;
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
        contextPack,
        chatMessages,
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
  "relativePath": "optional workspace image path for image_to_text (e.g. uploads/photo.png)",
  "reason": "short why"
}

Rules:
- Prefer mode=use_tool until acceptanceChecks are met; then final_answer.
- mode=final_answer when evidence may already be enough; include action+code only if a short verify/check script is needed.
- mode=expand_goals only if the expansion/sub-goals clearly cannot produce the deliverable.
- Honor suggestedApproach / suggestedTools when sensible.
- If the user uploaded an image and wants text, OCR, or a description of what is in the image, use image_to_text (set relativePath or fileName). Do not use execute_script/Pillow for OCR.
- If requiresShell and a file is expected, call execute_script immediately. Named inputs in the user message / workspace baseline are enough — do not list_workspace_files first.
- If workspace outputs are required and no output filename is given, write the computed result to a file (result.txt is fine), print OUT/SIZE, then stop. Do not only print the answer in chat.
- Use list_workspace_files only to locate an unknown upload, not to confirm a fixture that is already named.
- If the user asked to implement/add code and the workspace only has specs/fixtures (no app files), WRITE the files. Do not loop searching for a missing stub.
- Do not final_answer with a progress report ("next steps", "once files are located"). Either create the deliverable or keep using tools.
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
            context: contextPack || null,
            instruction:
                recentNoopCount >= 2
                    ? 'Too many noops. Prefer the most direct tool, or final_answer if acceptanceChecks are met.'
                    : 'Follow goalExpansion. Choose one brain mode (use_tool|expand_goals|final_answer).',
        },
        null,
        2
    );

    const messages: Message[] = withContextChatMessages(
        { role: 'system', content: systemPrompt },
        chatMessages,
        { role: 'user', content: userPrompt }
    );

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
            maxTokens: 900,
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
        relativePath:
            typeof json.relativePath === 'string'
                ? json.relativePath
                : typeof json.imagePath === 'string'
                  ? json.imagePath
                  : typeof json.filePath === 'string'
                    ? json.filePath
                    : undefined,
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
    contextPack?: string;
    chatMessages?: Message[] | AgentChatWindow;
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
        contextPack,
        chatMessages,
    } = params;

    const format = String(goalExpansion?.outputFormat || '').toLowerCase();
    const expectsFile =
        goalExpansion?.requiresShell === true &&
        format !== 'chat_update' &&
        format !== 'text_answer';
    const requiresPersonalData = goalExpansion?.requiresPersonalData === true;

    const messages: Message[] = withContextChatMessages(
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
                    ? '- File existing alone is NOT enough when acceptanceChecks mention content (headers, BEGIN:VCALENDAR, row counts, etc.). Require tool evidence of those checks, or continue with a short verify script.\n' +
                      '- If lastResult already printed absolute path + size for the EXPECTED output (right extension/name) AND acceptanceChecks are evidenced, use ready_to_synthesize — do NOT re-run the same conversion.\n' +
                      '- Do NOT treat helper scripts (read_*.py, analyze_*.py, create_artifact.*) as the deliverable.\n' +
                      '- File deliverable: prefer shell listing / OUT=/SIZE= for the expected extension. After create, a one-line content sniff (head/python) that proves format is preferred before ready_to_synthesize.\n'
                    : '- Chat/text goals: if lastResult already answers the question (a list, a count, generated values) with successful tool output, use ready_to_synthesize. Do NOT invent extra verify loops, extra check scripts, or require a new file.\n') +
                (requiresPersonalData
                    ? '- Personal data: once 2+ domains appear in memory (or several searches already ran), use ready_to_synthesize. Do NOT keep searching for every missing detail forever — synthesize grounded advice and mark gaps.\n'
                    : '') +
                '- continue: more work needed (name the missing acceptanceCheck).\n' +
                '- retry: last action failed; set retryHint.\n' +
                'Honor budget mins/max.\n' +
                (activeSkillsBlock ? `\n${activeSkillsBlock}` : ''),
        },
        chatMessages,
        {
            role: 'user',
            content: JSON.stringify(
                {
                    goal: { title: goalTitle, description: goalDescription },
                    goalExpansion: goalExpansion || null,
                    lastAction,
                    lastResultSummary: lastResultSummary.slice(0, 3500),
                    memory: memorySummary.slice(0, 4500),
                    context: contextPack || null,
                    budget: budgetContext || null,
                    verifyInstruction:
                        'Check each acceptanceCheck. ready_to_synthesize only if all are evidenced; otherwise continue with the cheapest next verify/create step.',
                },
                null,
                2
            ),
        }
    );

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
            maxTokens: 500,
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
    contextPack?: string;
    chatMessages?: Message[] | AgentChatWindow;
    /** Real files on disk from shell listing — never invent beyond this list. */
    verifiedDiskDeliverables?: Array<{
        pathInAgentFolder: string;
        absolutePath: string;
        size: number;
    }>;
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
        contextPack,
        chatMessages,
        verifiedDiskDeliverables,
    } = params;

    const expectsFile = goalExpansion?.requiresShell === true;
    const diskList = (verifiedDiskDeliverables || [])
        .map((d) => `- ${d.pathInAgentFolder} | ${d.absolutePath} | ${d.size} bytes`)
        .slice(0, 12);
    const hasVerifiedDisk = diskList.length > 0;

    const pinToVerifiedDisk = (text: string): string => {
        if (!text || !hasVerifiedDisk) return text;
        const allowed = new Set(
            (verifiedDiskDeliverables || []).map((d) =>
                (d.pathInAgentFolder.split('/').pop() || d.pathInAgentFolder).toLowerCase()
            )
        );
        const cited = [
            ...text.matchAll(
                /\b([A-Za-z0-9][\w.-]*\.(?:pdf|xlsx|xls|csv|tsv|png|jpe?g|webp|gif|zip|docx|txt|md|eml|html|json|ics|js|mjs|cjs|ts|py|sql|ya?ml|mmd|db|sqlite3?))\b/gi
            ),
        ].map((m) => String(m[1] || '').toLowerCase());
        const invented = [...new Set(cited)].filter((n) => {
            if (allowed.has(n) || HELPER_SCRIPT_NAME_RE.test(n)) return false;
            if (/\.(js|mjs|cjs|ts|py|db|sqlite3?)$/i.test(n)) return true;
            const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`${esc}[^\\n]{0,100}\\d+\\s*bytes|\\d+\\s*bytes[^\\n]{0,100}${esc}`, 'i').test(
                text
            );
        });
        if (!invented.length) return text;
        return `${text.trim()}\n\nActual workspace files (authoritative; ignore invented names/sizes):\n${diskList.join('\n')}`.slice(
            0,
            12000
        );
    };

    const messages: Message[] = withContextChatMessages(
        {
            role: 'system',
            content:
                'You write the FINAL ANSWER for an autonomous agent.\n' +
                'Follow the goal expansion outputFormat and successCriteria.\n' +
                (expectsFile
                    ? hasVerifiedDisk
                        ? 'VERIFIED_DISK_FILES lists real files on disk. Copy those names and sizes EXACTLY. Never invent, rename, or add files that are not on that list.\n'
                        : 'No verified workspace deliverable is on disk. You MUST say the expected file was NOT created. Do not invent Absolute Path / File Size.\n'
                    : 'Citation-first when personal evidence exists; mark speculation clearly.\n') +
                'Be practical and structured. Plain text only.\n' +
                (activeSkillsBlock ? `\n${activeSkillsBlock}` : ''),
        },
        chatMessages,
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
                contextPack ? `CONTEXT WINDOW:\n${contextPack}` : '',
                `EVIDENCE / MEMORY:\n${memorySummary || '(none)'}`,
                expectsFile
                    ? hasVerifiedDisk
                        ? `VERIFIED_DISK_FILES (only cite these):\n${diskList.join('\n')}`
                        : 'VERIFIED_DISK_FILES:\n(none — do not invent paths)'
                    : '',
                budgetContext
                    ? `BUDGET STATUS:\n${JSON.stringify(budgetContext, null, 2)}`
                    : '',
                'Write the final answer now.',
            ]
                .filter(Boolean)
                .join('\n\n'),
        }
    );

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
        if (!logCtx.agentInstanceId || logCtx.past) return;
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
            const finalContent = pinToVerifiedDisk(
                cancelled || streamResult.cancelled
                    ? answer
                        ? `${answer}\n\n(Generation stopped.)`
                        : '(Generation cancelled.)'
                    : answer
            );

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
                    usage: {
                        promptTokens: streamResult.promptTokens || 0,
                        completionTokens: streamResult.completionTokens || 0,
                        reasoningTokens: streamResult.reasoningTokens || 0,
                        totalTokens: streamResult.totalTokens || 0,
                        costInUsd: streamResult.costInUsd || 0,
                    },
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

    const answer = pinToVerifiedDisk((llmResult.content || '').trim());
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
        `Could not fully synthesize a richer answer this tick — continue with tools.\n\n` +
        `${memorySummary.slice(0, 2000) || 'No evidence was collected yet.'}`;

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
        .filter((m) => !isAgentContextMemoryKey(m.key))
        .slice(0, 25)
        .map((m) => `- [${m.memoryType || 'other'}] ${m.key}: ${m.content.slice(0, 800)}`)
        .join('\n')
        .slice(0, 12000);
