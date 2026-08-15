/**
 * Per-call max tokens for agent script generation (execute_script code-gen).
 *
 * Distinct from chatLlmMaxTokens (chat replies) and agentMaxBudgetTokens
 * (whole-run budget). Hardcoded 3000 used to cut large files in half so
 * they failed when executed.
 */

export const AGENT_SCRIPT_MAX_TOKENS_DEFAULT = 8192;
export const AGENT_SCRIPT_MAX_TOKENS_MIN = 512;
export const AGENT_SCRIPT_MAX_TOKENS_MAX = 128_000;
export const AGENT_SCRIPT_CONTINUE_MAX = 3;

const clampInt = (n: unknown, min: number, max: number, fallback: number): number => {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
};

export const normalizeAgentScriptMaxTokens = (value?: number | null): number =>
    clampInt(value, AGENT_SCRIPT_MAX_TOKENS_MIN, AGENT_SCRIPT_MAX_TOKENS_MAX, AGENT_SCRIPT_MAX_TOKENS_DEFAULT);

export const resolveAgentScriptMaxTokens = (doc?: {
    agentScriptMaxTokens?: number | null;
    chatLlmMaxTokens?: number | null;
} | null): number => {
    const dedicated = Number(doc?.agentScriptMaxTokens);
    if (Number.isFinite(dedicated) && dedicated >= AGENT_SCRIPT_MAX_TOKENS_MIN) {
        return normalizeAgentScriptMaxTokens(dedicated);
    }
    const chat = Number(doc?.chatLlmMaxTokens);
    if (Number.isFinite(chat) && chat > AGENT_SCRIPT_MAX_TOKENS_DEFAULT) {
        return normalizeAgentScriptMaxTokens(chat);
    }
    return AGENT_SCRIPT_MAX_TOKENS_DEFAULT;
};

/**
 * Auto-scale the per-call budget for the task.
 * Script max tokens (`configured`) is the hard max and is never exceeded.
 */
export const scaleScriptMaxTokensForTask = (_prompt: string, configured: number): number =>
    configured;

const lastNonEmptyLine = (code: string): string => {
    const lines = (code || '').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (t) return t;
    }
    return '';
};

const netOpenDelimiters = (code: string, scriptType: 'node' | 'python'): number => {
    let curly = 0;
    let round = 0;
    let square = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        const next = code[i + 1];
        if (inLineComment) {
            if (ch === '\n') inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }
        if (inSingle) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (ch === "'") inSingle = false;
            continue;
        }
        if (inDouble) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (ch === '"') inDouble = false;
            continue;
        }
        if (inTemplate) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (ch === '`') inTemplate = false;
            continue;
        }
        if (scriptType === 'python' && ch === '#' && (i === 0 || /\s/.test(code[i - 1]))) {
            inLineComment = true;
            continue;
        }
        if (ch === '/' && next === '/') {
            inLineComment = true;
            i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }
        if (ch === "'") {
            inSingle = true;
            continue;
        }
        if (ch === '"') {
            inDouble = true;
            continue;
        }
        if (ch === '`') {
            inTemplate = true;
            continue;
        }
        if (ch === '{') curly++;
        else if (ch === '}') curly--;
        else if (ch === '(') round++;
        else if (ch === '[') square++;
        else if (ch === ']') square--;
        else if (ch === ')') round--;
    }
    if (inSingle || inDouble || inTemplate || inBlockComment) return 1;
    return Math.max(0, curly) + Math.max(0, round) + Math.max(0, square);
};

/** True when generated source looks cut off by a max-token limit. */
export const looksLikeIncompleteScript = (
    code: string,
    scriptType: 'node' | 'python'
): boolean => {
    const text = (code || '').trim();
    if (text.length < 8) return true;
    if (netOpenDelimiters(text, scriptType) > 0) return true;

    const last = lastNonEmptyLine(text);
    if (/[,([{=:+\\]$/.test(last)) return true;
    if (scriptType === 'python') {
        if (/:$/.test(last) && !/\blambda\b/.test(last)) return true;
        const triples =
            (text.match(/'''/g) || []).length + (text.match(/"""/g) || []).length;
        if (triples % 2 === 1) return true;
    }
    return false;
};

export const stripGeneratedCodeFences = (raw: string): string =>
    (raw || '')
        .replace(/^```[a-z]*\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim();
