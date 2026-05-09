import axios from 'axios';
import path from 'path';
import mongoose, { HydratedDocument } from 'mongoose';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelChatShellRunGroup } from '../../../../schema/schemaChatLlm/SchemaShellExecute/SchemaChatShellRunGroup.schema';
import { ModelChatShellRunTodo } from '../../../../schema/schemaChatLlm/SchemaShellExecute/SchemaChatShellRunTodo.schema';
import { ModelChatShellGeneratedFile } from '../../../../schema/schemaChatLlm/SchemaShellExecute/SchemaChatShellGeneratedFile.schema';
import { ModelUserFileUpload } from '../../../../schema/schemaUser/SchemaUserFileUpload.schema';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import { getLlmConfig } from '../answerMachineV2/helperFunction/answerMachineGetLlmConfig';
import fetchLlmUnified, { Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { putFile, S3Config } from '../../../../utils/upload/uploadFunc';
import { constructFeatureUploadObjectKey } from '../../../../utils/upload/constructFeatureUploadObjectKey';
import { uploadRecentUserFilesToShellWorkspace } from './shellWorkspaceFileUpload';
import { shellLineToSpawnArgv } from './shellLineToSpawnArgv';
import { importAnswerMachineOutputsAfterShellExecute } from '../answerMachineShellWorkspaceOutputs';
import type { ChatShellExecuteStrategy } from '../../../../types/typesSchema/typesChatLlm/SchemaChatShellRunTodo.types';
import type {
    IShellRunArtifactV1,
    IShellRunArtifactV1Plain,
} from '../../../../types/typesSchema/typesChatLlm/SchemaShellRunArtifactV1.types';

export type { IShellRunArtifactV1, IShellRunArtifactV1Plain } from '../../../../types/typesSchema/typesChatLlm/SchemaShellRunArtifactV1.types';
import type { IChatLlmThread } from '../../../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types';
import type { IChatShellRunGroup } from '../../../../types/typesSchema/typesChatLlm/SchemaChatShellRunGroup.types';
import type IUserApiKey from '../../../../types/typesSchema/typesUser/SchemaUserApiKey.types';
import type IUserFileUpload from '../../../../types/typesSchema/typesUser/SchemaUserFileUpload.types';
import type { DefaultDateTimeIpAddress } from '../../../../utils/llm/normalizeDateTimeIpAddress';

const SHELL_RUN_LOG = '[runChatShellForThread]';

/** Planner JSON array max length (prompt + normalizeTodos must match). */
const SHELL_PLANNER_MAX_TODOS = 16;

const SHELL_EXECUTE_MIN_ATTEMPTS = 1;
const SHELL_RETRY_BACKOFF_MS = 600;

function resolveShellExecuteMaxAttempts(): number {
    const raw = process.env.SHELL_EXECUTE_MAX_ATTEMPTS;
    if (raw === undefined || raw === '') {
        return 3;
    }
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) {
        return 3;
    }
    return Math.min(10, Math.max(SHELL_EXECUTE_MIN_ATTEMPTS, n));
}

/** Inclusive attempt index range per shell todo primary command; thread overrides env default max. */
function resolvePrimaryAttemptRangeFromThread(thread: HydratedDocument<IChatLlmThread>): {
    minAttempt: number;
    maxAttempt: number;
} {
    if (thread.answerEngine === 'answerMachine3' && thread.executeShell) {
        return { minAttempt: 1, maxAttempt: 1 };
    }
    const envDefaultMax = resolveShellExecuteMaxAttempts();
    const rawMax = thread.shellExecuteMaxAttempts;
    let maxA =
        typeof rawMax === 'number' && Number.isFinite(rawMax) && !Number.isNaN(rawMax)
            ? Math.round(rawMax)
            : envDefaultMax;
    maxA = Math.min(10, Math.max(1, maxA));
    const rawMin = thread.shellExecuteMinAttempts;
    let minA =
        typeof rawMin === 'number' && Number.isFinite(rawMin) && !Number.isNaN(rawMin)
            ? Math.round(rawMin)
            : 1;
    minA = Math.min(10, Math.max(1, minA));
    if (minA > maxA) {
        minA = 1;
    }
    return { minAttempt: minA, maxAttempt: maxA };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

type ParsedTodo = {
    taskName: string;
    executeStrategyBy: ChatShellExecuteStrategy;
    shellCommand: string;
    /** Optional; runs once after primary succeeds (same validation as shellCommand). */
    verifyShellCommand?: string;
};

const ARTIFACT_PREVIEW_MAX = 800;

function clipForArtifact(text: string, max = ARTIFACT_PREVIEW_MAX): string {
    const t = text || '';
    if (t.length <= max) return t;
    return `${t.slice(0, max)}…`;
}

async function buildShellRunArtifactV1(params: {
    chatShellRunGroupId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<IShellRunArtifactV1Plain> {
    const { chatShellRunGroupId, threadId, username } = params;

    const todoRows = await ModelChatShellRunTodo.find({ chatShellRunGroupId })
        .sort({ orderIndex: 1 })
        .lean();

    const fileRows = await ModelChatShellGeneratedFile.find({ chatShellRunGroupId })
        .sort({ createdAtUtc: 1 })
        .lean();

    return {
        version: 1,
        kind: 'shell_run',
        chatShellRunGroupId: String(chatShellRunGroupId),
        threadId: String(threadId),
        username,
        completedAtUtc: new Date().toISOString(),
        todos: todoRows.map((row) => ({
            orderIndex: row.orderIndex ?? 0,
            taskName: row.taskName,
            executeStrategyBy: row.executeStrategyBy,
            shellCommand: clipForArtifact(row.shellCommand || '', 400),
            verifyShellCommand: row.verifyShellCommand
                ? clipForArtifact(row.verifyShellCommand, 400)
                : undefined,
            attemptCount: row.attemptCount ?? 0,
            status: row.status,
            exitCode: row.exitCode ?? null,
            verifyExitCode: row.verifyExitCode ?? null,
            stdoutPreview: clipForArtifact(row.stdout || ''),
            stderrPreview: clipForArtifact(row.stderr || ''),
        })),
        importedFiles: fileRows.map((row) => ({
            fileName: row.fileName,
            mimeType: row.mimeType,
            storedFileUrl: row.storedFileUrl,
            relativePath: row.relativePath,
            summaryPreview: clipForArtifact(row.summary || ''),
        })),
    };
}

function mapPlainArtifactToChatSubdocument(params: { plain: IShellRunArtifactV1Plain }): IShellRunArtifactV1 {
    const { plain } = params;
    return {
        version: plain.version,
        kind: plain.kind,
        chatShellRunGroupId: new mongoose.Types.ObjectId(plain.chatShellRunGroupId),
        threadId: new mongoose.Types.ObjectId(plain.threadId),
        username: plain.username,
        completedAtUtc: new Date(plain.completedAtUtc),
        todos: plain.todos,
        importedFiles: plain.importedFiles,
    };
}

const STRATEGIES: ChatShellExecuteStrategy[] = [
    'llm',
    'shellExecute',
    'browserIntegration',
    'internalKnowledgeAndLlm',
];

/** No raw `"` inside the node -e shell token — avoids bash quote tracking bugs that reject `python3 -c "..."` when HTML contains `style="..."`. */
const NODE_WRITE_DATETIME_HTML_ONE_LINER =
    'node -e "require(\'fs\').writeFileSync(\'datetime.html\',[\'<html><body><h1>Current time</h1><p>\',new Date().toISOString(),\'</p></body></html>\'].join(\'\'))"';

/** Fallback: simple HTML only — no double quotes inside the Python string (bash wraps the whole -c in `"`). */
const PYTHON_WRITE_DATETIME_HTML_ONE_LINER =
    'python3 -c "import datetime; dt=datetime.datetime.now().strftime(\'%Y-%m-%d %H:%M:%S\'); open(\'datetime.html\',\'w\').write(\'<html><body><h1>Current Datetime</h1><p>\'+dt+\'</p></body></html>\')"';

/** Planner + shell: runtime is Ubuntu 24.04 Docker; steer toward valid one-line commands and safe quoting. */
const SHELL_EXECUTE_COMMAND_GUIDANCE =
    'RUNTIME: Commands execute on **Ubuntu 24.04** in **Docker** (glibc, GNU userland). Includes **Node.js 24**, **npm**, **Python 3**, **apt-get**, **curl**, **wget**, **git**, **build-essential**, **openssl**, **Chromium**, **ffmpeg**, **sqlite3**, **zip/unzip**, and common CLI tools.\n' +
    'BOUNDED EXECUTION: Each run has a **server timeout** (about **60s** by default; longer when the command clearly does **apt** / **npm** / **pip** installs). You may **install packages and run arbitrary CLI tools** suitable for the task, but avoid **infinite loops** (\`while true\`), **fork bombs**, **unbounded recursion**, **long-lived daemons** or listeners that never exit, and unbounded **tail -f** / blocking reads — design pipelines that **finish** and leave stdout or files in the workspace.\n' +
    'PYTHON / PIP (**PEP 668**): System Python is **externally-managed**. **Do not** append `&& pip install ...` after apt on distro Python — it fails with **externally-managed-environment** (exit 1) even when apt succeeded. For **WeasyPrint** use **only** `apt-get update -qq && apt-get install -y --no-install-recommends weasyprint` (Debian package is enough; skip pip). For PyPI-only packages use `python3 -m venv .venv && .venv/bin/pip install ...` in the thread cwd, or **npm/Node**.\n' +
    'TOOL PREFERENCE (fixed order when more than one approach fits): **(1) Node.js** — `node -e`, `node ./script.js`, npm/npx first; **(2) Python 3** — `python3 -c` or venv **only** when Node is awkward or clearly worse; **(3) other** — chromium, curl, standard POSIX utilities, etc., when the task clearly needs them.\n' +
    'SHELL COMMAND STYLE (each shellCommand is ONE physical line; the API rejects unquoted `|;&` shell chaining, backticks, and `$` / `${` outside single-quoted spans):\n' +
    '1) Default to **node -e** or **node ./script.js** for generating HTML/JSON/text and small logic; use **python3** only after Node is ruled out; use **bash -c**, **openssl**, **apt-get**, **npm** when clearly better.\n' +
    '2) To run multiple shell steps in one line, wrap them in **bash -c** with a **single-quoted** inner script, e.g. `bash -c \'apt-get update -qq && apt-get install -y --no-install-recommends PKG\'` so `&&` is not unquoted at the top level.\n' +
    '3) For npm: use `npm install <pkg> --no-save --no-fund --no-audit` (or **npx -y** when appropriate), then a later shellExecute that **require()**s the package from the same thread cwd.\n' +
    '4) If the thread has **[Shell workspace: ... uploaded ...]**, those strings are **real paths** on disk — copy them **verbatim** into shellCommand (or use the **basename** only, since cwd is that folder). **Never** use placeholders like `input_file`, `output_file.png`, `YOUR_IMAGE.jpg`, or `photo.ext` — ImageMagick `convert`/`magick`, ffmpeg, and `file` will fail with "No such file or directory". If names are unclear, first shellExecute: `ls -F` then use an actual name from stdout in the next todo.\n' +
    '5) Write NEW outputs under the thread workspace (see [Shell workspace cwd ...]) so the server can import them.\n' +
    '5b) **Website → PNG (headless screenshot):** Use **`chromium`** or **`/usr/bin/chromium`** (Debian package, already installed). Example: `chromium --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage --screenshot=page.png` then the target URL as the last argument (wrap the URL in single quotes in bash if it has query params). **Never use `chromium-browser`** and **never `apt-get install chromium-browser`** — on Ubuntu 24.04 that metapackage is a **snap stub** (requires the chromium snap); **snap is unavailable in Docker**, so the command always fails. Do not run `snap install chromium`. If a prior step installed chromium-browser, use **`chromium`** only in the next step.\n' +
    '6) PDFs: **weasyprint** / **wkhtmltopdf** via **apt** first; **pdfkit** / **puppeteer** via npm if needed. After HTML exists in cwd: `weasyprint datetime.html datetime.pdf`. Do not run weasyprint until the HTML step **exits 0**.\n' +
    '7) **node -e "..."**: no real newlines in shellCommand; no **${...}** in double-quoted Node (bash expands it). Build strings with `+` or `.join()`. **Avoid raw `"` characters inside HTML** when using `python3 -c "..."` — bash sees those `"` and the validator treats `;` in Python as unquoted shell chaining. Prefer **NODE_GOLDEN** below for datetime HTML.\n' +
    '7b) **python3 -c** (only if Node is awkward): no f-strings; no `strftime(\\\'...\\\')` (backslash-quote breaks). Keep HTML free of `"` or wrap the whole step in `bash -c \'...\'` with a single-quoted inner script.\n' +
    '7c) **GOLDEN — write datetime.html with Node** (same cwd as weasyprint): ' +
    NODE_WRITE_DATETIME_HTML_ONE_LINER +
    '\n' +
    '7c-alt) Python fallback (simple markup only): ' +
    PYTHON_WRITE_DATETIME_HTML_ONE_LINER +
    '\n' +
    '7d) WeasyPrint: `weasyprint INPUT.html OUTPUT.pdf` only after the HTML file exists.\n' +
    '8) **Change approach across todos:** Split **install** (apt only for weasyprint), **write HTML** (Node golden), **convert PDF**, across ordered shellExecute steps.\n' +
    '9) **Mix strategies:** e.g. **llm** then **shellExecute** to materialize files. User uploads in [Shell workspace: ...] are on disk for later steps.\n';

type LlmConfigNonNull = NonNullable<Awaited<ReturnType<typeof getLlmConfig>>>;

type ShellRunCtx = {
    threadId: mongoose.Types.ObjectId;
    username: string;
    actionDatetimeObj: DefaultDateTimeIpAddress;
    thread: HydratedDocument<IChatLlmThread>;
    userKeyDoc: HydratedDocument<IUserApiKey>;
    keys: ReturnType<typeof getApiKeyByObject>;
    apiBase: string;
    token: string;
    group: HydratedDocument<IChatShellRunGroup>;
    failGroup: (msg: string) => Promise<void>;
    convo: string;
    latestUserText: string;
    llmConfig: LlmConfigNonNull;
    todos: ParsedTodo[];
    todoDocs: mongoose.Types.ObjectId[];
    nonShellSummary: string;
    shellLines: string[];
    fileLines: string[];
    shellFailureAppendix: string;
    storageType: 's3' | 'gridfs';
    s3Config: S3Config | undefined;
};

function logStep(stepNum: number, message: string, detail?: Record<string, unknown>) {
    const label = `step${stepNum}`;
    if (detail !== undefined) {
        console.log(SHELL_RUN_LOG, label, message, detail);
    } else {
        console.log(SHELL_RUN_LOG, label, message);
    }
}

function isValidStrategy(s: string): s is ChatShellExecuteStrategy {
    return (STRATEGIES as string[]).includes(s);
}

/**
 * One-line shell string validated then parsed into `spawn(cmd, args, { shell: false })` on the shell engine.
 * Newlines break parsing; `$` / `${` expand outside single-quoted spans; unquoted |;& at host level (rejected).
 */
function validateShellCommand(raw: string | undefined): { ok: true; cmd: string } | { ok: false; reason: string } {
    if (typeof raw !== 'string' || !raw.trim()) {
        return { ok: false, reason: 'Empty shell command.' };
    }
    const cmd = raw.trim();
    if (/[\n\r]/.test(cmd)) {
        return {
            ok: false,
            reason:
                'Multiline shellCommand is not allowed (newline breaks node -e quoting). Use exactly ONE line; put \\n inside the JavaScript string for HTML newlines.',
        };
    }
    if (cmd.includes('`')) {
        return { ok: false, reason: 'Backticks are not allowed in shellCommand.' };
    }
    const dollarIssue = findDollarOrTemplateOutsideSingleQuotes(cmd);
    if (dollarIssue) {
        return { ok: false, reason: dollarIssue.reason };
    }
    const splitter = findUnquotedShellSplitter(cmd);
    if (splitter) {
        const nestedQuoteHint =
            splitter === ';'
                ? ' If you used python3 -c "..." with HTML that contains attribute double-quotes (style="..."), bash/our checker mis-counts quotes — use the Node golden one-liner from shell guidance (no raw " inside HTML) or bash -c with a single-quoted inner script.'
                : '';
        return {
            ok: false,
            reason: `Do not use unquoted "${splitter}" for shell chaining (multiple commands). Semicolons inside node -e "..." JavaScript are OK while the opening double-quote is still open; keep the whole shellCommand as one invocation.${nestedQuoteHint}`,
        };
    }
    return { ok: true, cmd };
}

/** | ; & only when outside both '...' and "..." (bash-style). Allows node -e "const a=1; const b=2;" */
function findUnquotedShellSplitter(cmd: string): '|' | ';' | '&' | null {
    let inDouble = false;
    let inSingle = false;
    let escape = false;
    for (let i = 0; i < cmd.length; i++) {
        const c = cmd[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (inDouble && c === '\\') {
            escape = true;
            continue;
        }
        if (!inSingle && c === '"') {
            inDouble = !inDouble;
            continue;
        }
        if (!inDouble && c === "'") {
            inSingle = !inSingle;
            continue;
        }
        if (!inDouble && !inSingle) {
            if (c === '|') return '|';
            if (c === ';') return ';';
            if (c === '&') return '&';
        }
    }
    return null;
}

/**
 * In bash, `$` and `${` expand in unquoted and double-quoted regions, not inside `'...'`.
 * Allows e.g. `bash -c 'apt-get update && apt-get install -y pkg'`.
 */
function findDollarOrTemplateOutsideSingleQuotes(cmd: string): { reason: string } | null {
    let inDouble = false;
    let inSingle = false;
    let escape = false;
    for (let i = 0; i < cmd.length; i++) {
        const c = cmd[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (inDouble && c === '\\') {
            escape = true;
            continue;
        }
        if (!inSingle && c === '"') {
            inDouble = !inDouble;
            continue;
        }
        if (!inDouble && c === "'") {
            inSingle = !inSingle;
            continue;
        }
        if (inSingle) {
            continue;
        }
        if (c === '$' && cmd[i + 1] === '{') {
            return {
                reason:
                    'Do not use ${...} outside single quotes (bash expands it before node runs). Use JavaScript + for strings inside node -e "...", or put the whole inner script in single quotes via bash -c.',
            };
        }
        if (c === '$') {
            return {
                reason:
                    'Do not use $VAR outside single quotes (bash expands it). Use bash -c \'...\' for inner shell that needs $, or avoid $ in double-quoted node -e.',
            };
        }
    }
    return null;
}

function looksComputeLike(text: string): boolean {
    return /\b(md5|sha\d*|hash|checksum|base64|encode|decode|openssl|certutil|crc|digest)\b/i.test(text);
}

function hasRunnableShellTodo(todos: ParsedTodo[]): boolean {
    return todos.some((t) => t.executeStrategyBy === 'shellExecute' && validateShellCommand(t.shellCommand || '').ok);
}

async function tryGenerateShellTodoWithLlm(params: {
    llmConfig: LlmConfigNonNull;
    latestUserText: string;
    convo: string;
    extraDirective: string;
}): Promise<ParsedTodo | null> {
    const { llmConfig, latestUserText, convo, extraDirective } = params;
    console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'start', { extraDirectivePreview: extraDirective.slice(0, 120) });
    const fbMessages: Message[] = [
        {
            role: 'system',
            content: `You output exactly one JSON object with keys "taskName" and "shellCommand" only. No markdown, no code fences.
The shell runs on Ubuntu 24.04 in Docker (see RUNTIME in guidance). shellCommand must be a SINGLE physical line.
You may install and run what the task needs, but each invocation is **time-limited** — avoid infinite loops, daemons that never exit, or unbounded blocking; the process must **finish**.
When choosing a runtime, use **Node.js first**, **Python 3 second**, **other tools third** (same order as TOOL PREFERENCE in guidance).
Forbidden: backticks, real newlines, unquoted | ; & at the top shell level, and $ / \${ outside single-quoted spans (bash expands them). Prefer **node -e** for HTML files. Semicolons inside node -e "..." JavaScript are OK while the outer bash double-quote is still open.
${SHELL_EXECUTE_COMMAND_GUIDANCE}
Example MD5 of a literal string (no $):
node -e "console.log(require('crypto').createHash('md5').update('YOUR_STRING').digest('hex'))"
For file hashes on disk under ai-notes-xyz-shell-files, prefer openssl dgst -sha256 PATH or sha256sum PATH on this Linux image.
${extraDirective}`,
        },
        {
            role: 'user',
            content: `LATEST USER MESSAGE:\n${latestUserText}\n\nTHREAD CONTEXT (truncated):\n${convo.slice(-3500)}`,
        },
    ];

    const fb = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: fbMessages,
        temperature: 0.15,
        maxTokens: 512,
        headersExtra: llmConfig.customHeaders,
        responseFormat: 'json_object',
    });

    if (!fb.success || !fb.content) {
        console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'LLM call failed or empty', {
            success: fb.success,
            hasContent: Boolean(fb.content),
        });
        return null;
    }
    let obj: unknown;
    try {
        obj = JSON.parse(fb.content.trim());
    } catch {
        console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'JSON.parse failed', {
            contentPreview: fb.content.trim().slice(0, 200),
        });
        return null;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'parsed value not a plain object');
        return null;
    }
    const o = obj as Record<string, unknown>;
    const taskName = typeof o.taskName === 'string' ? o.taskName.trim() : '';
    const shellCommand = typeof o.shellCommand === 'string' ? o.shellCommand.trim() : '';
    const v = validateShellCommand(shellCommand);
    if (!taskName || !v.ok) {
        console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'reject after validate', {
            hasTaskName: Boolean(taskName),
            valid: v.ok,
            reason: !v.ok ? v.reason : undefined,
        });
        return null;
    }
    console.log(SHELL_RUN_LOG, 'tryGenerateShellTodoWithLlm', 'success', { taskName, shellCommandPreview: v.cmd.slice(0, 200) });
    return {
        taskName,
        executeStrategyBy: 'shellExecute',
        shellCommand: v.cmd,
    };
}

function extractJsonArray(text: string): unknown[] | null {
    const trimmed = text.trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fence ? fence[1].trim() : trimmed;
    try {
        const parsed = JSON.parse(candidate);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        try {
            const start = candidate.indexOf('[');
            const end = candidate.lastIndexOf(']');
            if (start >= 0 && end > start) {
                const parsed = JSON.parse(candidate.slice(start, end + 1));
                return Array.isArray(parsed) ? parsed : null;
            }
        } catch {
            return null;
        }
        return null;
    }
}

function normalizeTodos(raw: unknown[]): ParsedTodo[] {
    const out: ParsedTodo[] = [];
    for (const item of raw.slice(0, 10)) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const o = item as Record<string, unknown>;
        const taskName = typeof o.taskName === 'string' ? o.taskName.trim() : '';
        const strat = typeof o.executeStrategyBy === 'string' ? o.executeStrategyBy.trim() : '';
        const shellCommand = typeof o.shellCommand === 'string' ? o.shellCommand : '';
        if (!taskName || !isValidStrategy(strat)) continue;
        out.push({
            taskName,
            executeStrategyBy: strat,
            shellCommand,
        });
    }
    return out;
}

function extractShellRelativePaths(text: string): string[] {
    const found = new Set<string>();
    const re = /[^\s"'<>]+ai-notes-xyz-shell-files[^\s"'<>]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        let p = m[0].replace(/^[`"'(,]+|[\)`"',.;:]+$/g, '');
        p = p.replace(/\\/g, '/');
        if (!p.includes('..')) {
            found.add(p);
        }
    }
    return [...found];
}

function shellThreadWorkspaceRelativeDir(threadId: mongoose.Types.ObjectId): string {
    return `ai-notes-xyz-shell-files/thread-${String(threadId)}`;
}

function clipShellOutput(text: string, max: number): string {
    const t = text || '';
    if (t.length <= max) return t;
    return `${t.slice(0, max)}…`;
}

function shellExecuteTimeoutMs(command: string): number {
    const c = command.toLowerCase();
    if (c.includes('apt-get') || c.includes('apt install') || c.includes('apt update')) {
        return 180_000;
    }
    if (c.includes('pip install') || c.includes('pip3 install')) {
        return 120_000;
    }
    if (c.includes('npm install') || c.includes('npm i ') || c.includes('npx ')) {
        return 120_000;
    }
    return 60_000;
}

type PostShellExecuteOnceOk = {
    ok: true;
    httpOk: boolean;
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
};

type PostShellExecuteOnceErr = {
    ok: false;
    message: string;
};

async function postShellExecuteOnce(params: {
    apiBase: string;
    token: string;
    threadDir: string;
    command: string;
    timeoutMs: number;
    axiosTimeoutMs: number;
}): Promise<PostShellExecuteOnceOk | PostShellExecuteOnceErr> {
    const { apiBase, token, threadDir, command, timeoutMs, axiosTimeoutMs } = params;
    const parsed = shellLineToSpawnArgv(command);
    if (!parsed.ok) {
        return {
            ok: false,
            message: `Shell command parse error (${parsed.reason}). Fix quoting or use bash -c with a single-quoted inner script.`,
        };
    }
    try {
        const execRes = await axios.post(
            `${apiBase}/shell-engine/run-shell/execute`,
            {
                cmd: parsed.cmd,
                args: parsed.args,
                /** Legacy shell engines (exec + single string) read `command` only; keep in sync for rollout */
                command: command.trim(),
                timeoutMs,
                cwd: threadDir,
            },
            {
                timeout: axiosTimeoutMs,
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Token': token,
                },
                validateStatus: () => true,
            },
        );

        const body = execRes.data as Record<string, unknown>;
        let stdout = typeof body.stdout === 'string' ? body.stdout : '';
        let stderr = typeof body.stderr === 'string' ? body.stderr : '';
        const httpOk = execRes.status === 200;
        let exitCode = typeof body.exitCode === 'number' ? body.exitCode : null;
        if (exitCode === null && httpOk) {
            exitCode = 0;
        } else if (exitCode === null && !httpOk) {
            exitCode = 1;
        }
        const timedOut = Boolean(body.timedOut);
        if (!httpOk) {
            const apiMsg =
                typeof body.message === 'string' && body.message.trim() !== ''
                    ? body.message.trim()
                    : `${execRes.status} ${execRes.statusText || ''}`.trim();
            const shellEngineNote = `[shell-engine HTTP ${execRes.status}] ${apiMsg}`;
            stderr = stderr ? `${stderr}\n${shellEngineNote}` : shellEngineNote;
        }
        return { ok: true, httpOk, exitCode, timedOut, stdout, stderr };
    } catch (cmdErr) {
        return {
            ok: false,
            message: cmdErr instanceof Error ? cmdErr.message : 'execute error',
        };
    }
}

/**
 * After a failed shell attempt (before the next retry), ask the LLM for a revised one-line command
 * or to keep the same strategy. Only validated, changed commands are returned.
 */
async function llmMaybeReviseShellCommandForRetry(params: {
    llmConfig: LlmConfigNonNull;
    taskName: string;
    latestUserText: string;
    convoTail: string;
    originalPlannerCommand: string;
    currentCommand: string;
    attemptIndex: number;
    maxAttempts: number;
    transportFailed: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    httpOk: boolean;
}): Promise<string | null> {
    const {
        llmConfig,
        taskName,
        latestUserText,
        convoTail,
        originalPlannerCommand,
        currentCommand,
        attemptIndex,
        maxAttempts,
        transportFailed,
        stdout,
        stderr,
        exitCode,
        timedOut,
        httpOk,
    } = params;

    const sys = `You fix shell commands for the next retry on Ubuntu 24.04 in Docker.
Reply with ONLY a JSON object (no markdown): {"decision":"same"|"revise","shellCommand":"<one physical line>"}.
Rules:
- If the failure is transient or retrying unchanged is best, set decision to "same" and shellCommand to the exact current command (character-for-character).
- If stderr or context suggests a different approach, set decision to "revise" and shellCommand to the full replacement line for the NEXT attempt only.
- When revising implementation, prefer **Node.js** first, **Python 3** second, **other CLIs** third — same order as production shell guidance.
- shellCommand must pass the same constraints as production: ONE line; no backticks; no real newlines; no unquoted | ; & at the outer shell level; no $ or \${ outside single-quoted spans (use bash -c '...' for inner &&); the command must **finish** within the timeout (no infinite loops, fork bombs, or never-ending daemons).
- Never suggest snap or chromium-browser (snap stub in Docker). For headless web screenshots use chromium with --headless=new --no-sandbox --disable-dev-shm-usage, not chromium-browser.
- Do not suggest pip on system Python after apt (PEP 668).
Guidance excerpt:
${SHELL_EXECUTE_COMMAND_GUIDANCE.slice(0, 4500)}`;

    const userBody = [
        `Todo task name: ${taskName}`,
        `Attempt ${attemptIndex} of ${maxAttempts} failed (there will be another attempt only if you improve the command or confirm same).`,
        `Original planner command: ${originalPlannerCommand}`,
        `Command just executed: ${currentCommand}`,
        `Transport layer failed (HTTP/axios): ${transportFailed ? 'yes' : 'no'}`,
        `httpOk=${httpOk} exitCode=${exitCode === null ? 'null' : exitCode} timedOut=${timedOut}`,
        `stdout (trunc):\n${clipShellOutput(stdout, 2500)}`,
        `stderr (trunc):\n${clipShellOutput(stderr, 3500)}`,
        '',
        `Latest user message:\n${clipShellOutput(latestUserText, 2000)}`,
        '',
        `Thread context (tail):\n${clipShellOutput(convoTail, 3500)}`,
    ].join('\n');

    const fb = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userBody },
        ],
        temperature: 0.2,
        maxTokens: 900,
        headersExtra: llmConfig.customHeaders,
        responseFormat: 'json_object',
    });

    if (!fb.success || !fb.content) {
        logStep(9, 'retry LLM revise skipped', { reason: 'llm_unavailable', taskName });
        return null;
    }
    let obj: unknown;
    try {
        obj = JSON.parse(fb.content.trim());
    } catch {
        logStep(9, 'retry LLM revise skipped', { reason: 'json_parse', taskName });
        return null;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return null;
    }
    const o = obj as Record<string, unknown>;
    const decision = o.decision === 'revise' ? 'revise' : 'same';
    const shellCommand = typeof o.shellCommand === 'string' ? o.shellCommand.trim() : '';
    if (decision !== 'revise' || !shellCommand) {
        logStep(9, 'retry LLM revise same', { taskName, attemptIndex });
        return null;
    }
    const v = validateShellCommand(shellCommand);
    if (!v.ok) {
        logStep(9, 'retry LLM revise rejected_validate', { taskName, reason: v.reason, preview: shellCommand.slice(0, 160) });
        return null;
    }
    if (v.cmd === currentCommand) {
        logStep(9, 'retry LLM revise noop', { taskName, attemptIndex });
        return null;
    }
    logStep(9, 'retry LLM revise applied', {
        taskName,
        attemptIndex,
        previewFrom: currentCommand.slice(0, 120),
        previewTo: v.cmd.slice(0, 120),
    });
    return v.cmd;
}

function formatShellTodoResultLine(params: {
    taskName: string;
    safeCmd: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    httpOk: boolean;
    primaryAttemptsUsed?: number;
    primaryMaxAttempts?: number;
    verifyShellCommand?: string;
    verifyOk?: boolean;
    verifyExitCode?: number | null;
    verifyStdout?: string;
    verifyStderr?: string;
}): string {
    const {
        taskName,
        safeCmd,
        exitCode,
        stdout,
        stderr,
        timedOut,
        httpOk,
        primaryAttemptsUsed,
        primaryMaxAttempts,
        verifyShellCommand,
        verifyOk,
        verifyExitCode,
        verifyStdout,
        verifyStderr,
    } = params;
    const parts: string[] = [];
    const exitLabel =
        verifyOk === false
            ? 'verify failed'
            : !httpOk
              ? 'HTTP error'
              : timedOut
                ? 'timed out'
                : exitCode === null
                  ? 'n/a'
                  : String(exitCode);
    parts.push(`- **${taskName}** (exit ${exitLabel}):`);
    parts.push(`  \`${safeCmd}\``);
    if (primaryAttemptsUsed !== undefined && primaryMaxAttempts !== undefined && primaryMaxAttempts > 1) {
        parts.push(`  primary attempts: ${primaryAttemptsUsed}/${primaryMaxAttempts}`);
    }
    if (verifyShellCommand) {
        if (verifyOk === true) {
            parts.push(`  verify (exit 0): \`${clipShellOutput(verifyShellCommand, 400)}\``);
        } else if (verifyOk === false) {
            const vLabel =
                verifyExitCode === null ? 'rejected or error' : `exit ${verifyExitCode}`;
            parts.push(`  verify failed (${vLabel}): \`${clipShellOutput(verifyShellCommand, 400)}\``);
            if (verifyStdout?.trim()) {
                parts.push(`  verify stdout: ${clipShellOutput(verifyStdout, 800)}`);
            }
            if (verifyStderr?.trim()) {
                parts.push(`  verify stderr: ${clipShellOutput(verifyStderr, 1500)}`);
            }
        }
    }
    if (stdout.trim()) {
        parts.push(`  stdout: ${clipShellOutput(stdout, 1200)}`);
    }
    if (stderr.trim()) {
        parts.push(`  stderr: ${clipShellOutput(stderr, 3500)}`);
    }
    if (!stdout.trim() && !stderr.trim()) {
        parts.push('  *(no stdout/stderr)*');
    }
    return parts.join('\n');
}

type ShellFileListEntry = { relativePath: string; size: number; mtimeMs: number };

async function fetchShellFileListing(params: {
    apiBase: string;
    token: string;
    relativeDir: string;
    maxFiles?: number;
}): Promise<ShellFileListEntry[]> {
    const { apiBase, token, relativeDir, maxFiles = 400 } = params;
    try {
        const res = await axios.get(`${apiBase}/shell-engine/file/list`, {
            params: { relativeDir, maxFiles },
            timeout: 60_000,
            headers: { 'X-API-Token': token },
            validateStatus: () => true,
        });
        if (res.status !== 200) {
            return [];
        }
        const body = res.data as { files?: unknown };
        if (!body || !Array.isArray(body.files)) {
            return [];
        }
        const out: ShellFileListEntry[] = [];
        for (const row of body.files) {
            if (!row || typeof row !== 'object') continue;
            const o = row as Record<string, unknown>;
            const rp = typeof o.relativePath === 'string' ? o.relativePath.replace(/\\/g, '/') : '';
            if (!rp) continue;
            const size = typeof o.size === 'number' ? o.size : 0;
            const mtimeMs = typeof o.mtimeMs === 'number' ? o.mtimeMs : 0;
            out.push({ relativePath: rp, size, mtimeMs });
        }
        return out;
    } catch {
        return [];
    }
}

function fileMtimeMapFromListing(list: ShellFileListEntry[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const f of list) {
        m.set(f.relativePath.replace(/\\/g, '/'), f.mtimeMs);
    }
    return m;
}

/** Paths that are new or have a newer mtime than the last recorded snapshot (skip user-upload inputs). */
function collectThreadWorkspaceOutputPaths(params: {
    preSnapshot: Map<string, number>;
    currentListing: ShellFileListEntry[];
    skipPaths: Set<string>;
}): string[] {
    const { preSnapshot, currentListing, skipPaths } = params;
    const toImport: string[] = [];
    for (const f of currentListing) {
        const rel = f.relativePath.replace(/\\/g, '/');
        if (skipPaths.has(rel)) continue;
        const prev = preSnapshot.get(rel);
        if (prev === undefined || f.mtimeMs > prev) {
            toImport.push(rel);
        }
    }
    return toImport;
}

const SHELL_IMPORT_MAX_BYTES = 45 * 1024 * 1024;

async function tryImportShellRelativeFile(params: {
    rel: string;
    apiBase: string;
    token: string;
    group: HydratedDocument<IChatShellRunGroup>;
    threadId: mongoose.Types.ObjectId;
    username: string;
    todoId: mongoose.Types.ObjectId;
    storageType: 's3' | 'gridfs';
    s3Config: S3Config | undefined;
    skipPaths: Set<string>;
}): Promise<{ ok: true; fileLine: string; normalizedPath: string } | { ok: false }> {
    const { rel, apiBase, token, group, threadId, username, todoId, storageType, s3Config, skipPaths } = params;
    const normalized = rel.replace(/\\/g, '/');
    if (skipPaths.has(normalized)) {
        return { ok: false };
    }
    if (normalized.includes('..')) {
        return { ok: false };
    }

    try {
        logStep(9, 'file/read GET', { relativePath: normalized });
        const fileRes = await axios.get(`${apiBase}/shell-engine/file/read`, {
            params: { relativePath: normalized },
            responseType: 'arraybuffer',
            timeout: 60_000,
            headers: { 'X-API-Token': token },
            validateStatus: () => true,
        });
        logStep(9, 'file/read response', { relativePath: normalized, httpStatus: fileRes.status });
        if (fileRes.status !== 200 || !fileRes.data) {
            return { ok: false };
        }
        const buf = Buffer.from(fileRes.data as ArrayBuffer);
        if (buf.length > SHELL_IMPORT_MAX_BYTES) {
            logStep(9, 'skip file import — too large', { relativePath: normalized, bytes: buf.length });
            return { ok: false };
        }
        const ct =
            (typeof fileRes.headers['content-type'] === 'string'
                ? fileRes.headers['content-type']
                : 'application/octet-stream') || 'application/octet-stream';
        const baseName = normalized.split('/').pop() || `shell-file-${todoId}`;
        const fileExtension = path.extname(baseName) || '.bin';

        const fileRecordObj = (await ModelUserFileUpload.create({
            username,
            fileUploadPath: `ai-notes-xyz/${username}/temp/${Date.now()}.temp`,
            storageType,
        })) as IUserFileUpload;

        const fileNameStem = fileRecordObj._id.toString();
        const objectKey = constructFeatureUploadObjectKey(
            username,
            String(threadId),
            fileNameStem,
            fileExtension,
        );

        const put = await putFile({
            fileName: objectKey,
            fileContent: buf,
            contentType: ct,
            storageType,
            s3Config,
            metadata: {
                source: 'chatShellRun',
                threadId: String(threadId),
                groupId: String(group._id),
            },
        });

        logStep(9, 'putFile', { relativePath: normalized, success: put.success, fileId: put.fileId });
        if (!put.success || !put.fileId) {
            await ModelUserFileUpload.deleteOne({ _id: fileRecordObj._id });
            return { ok: false };
        }

        let summary = `[binary ${buf.length} bytes]`;
        if (ct.startsWith('text/') || ct.includes('json') || ct.includes('xml')) {
            const asText = buf.toString('utf8');
            summary = asText.slice(0, 2000);
            if (asText.length > 2000) summary += '…';
        }

        /** Same key as uploadFile / getFile: ai-notes-xyz/{user}/features/{threadId}/{uploadId}{ext}. */
        const downloadKey = objectKey;

        const updateData: Record<string, unknown> = {
            fileUploadPath: objectKey,
            storageType,
            parentEntityId: String(threadId),
            contentType: ct,
            originalName: baseName,
            size: buf.length,
        };
        if (storageType === 'gridfs' && mongoose.Types.ObjectId.isValid(put.fileId)) {
            updateData.gridFsId = new mongoose.Types.ObjectId(put.fileId);
        }
        await ModelUserFileUpload.findOneAndUpdate({ _id: fileRecordObj._id }, { $set: updateData });

        await ModelChatShellGeneratedFile.create({
            chatShellRunGroupId: group._id,
            threadId,
            username,
            todoId,
            relativePath: normalized,
            storedFileUrl: downloadKey,
            fileName: baseName,
            mimeType: ct,
            summary,
            createdAtUtc: new Date(),
        });

        logStep(9, 'ChatShellGeneratedFile + userFileUpload', { baseName, downloadKey });
        return {
            ok: true,
            fileLine: `- ${baseName} (shell \`${normalized}\`) — download: GET getFile with query \`fileName\` set to (URL-encoded) \`${downloadKey}\`.`,
            normalizedPath: normalized,
        };
    } catch (fileErr) {
        logStep(9, 'file import catch', { relativePath: normalized, err: fileErr });
        console.error('shell file import failed', fileErr);
        return { ok: false };
    }
}

async function shellStep1LoadThreadAndKeys(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<
    | { ok: true; data: Pick<ShellRunCtx, 'thread' | 'userKeyDoc' | 'keys' | 'apiBase' | 'token'> }
    | { ok: false; error: string }
> {
    const { threadId, username } = params;
    logStep(1, 'load thread and API keys', { threadId: String(threadId), username });

    const thread = await ModelChatLlmThread.findOne({ _id: threadId, username });
    if (!thread) {
        logStep(1, 'thread not found');
        return { ok: false, error: 'Thread not found' };
    }

    const userKeyDoc = await ModelUserApiKey.findOne({ username });
    if (!userKeyDoc) {
        logStep(1, 'User API keys doc missing');
        return { ok: false, error: 'User API keys not found' };
    }

    const keys = getApiKeyByObject(userKeyDoc);
    if (!keys.shellEngineValid || !keys.shellEngineUrl || !keys.shellEngineToken) {
        logStep(1, 'shell engine not configured on keys', {
            shellEngineValid: keys.shellEngineValid,
            hasUrl: Boolean(keys.shellEngineUrl),
            hasToken: Boolean(keys.shellEngineToken),
        });
        return {
            ok: false,
            error: 'Shell execute is enabled but Shell service is not configured in API Keys.',
        };
    }

    const shellOrigin = keys.shellEngineUrl.replace(/\/+$/, '');
    const apiBase = `${shellOrigin}/api`;
    const token = keys.shellEngineToken;
    logStep(1, 'shell HTTP target ready', { apiBase, tokenLength: token.length });

    return {
        ok: true,
        data: {
            thread: thread as HydratedDocument<IChatLlmThread>,
            userKeyDoc: userKeyDoc as HydratedDocument<IUserApiKey>,
            keys,
            apiBase,
            token,
        },
    };
}

async function shellStep2CreateRunGroup(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<{
    ok: true;
    data: Pick<ShellRunCtx, 'group' | 'failGroup'>;
}> {
    const { threadId, username } = params;
    logStep(2, 'create ChatShellRunGroup');

    const created = await ModelChatShellRunGroup.create({
        threadId,
        username,
        status: 'running',
        errorReason: '',
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });
    const group = (Array.isArray(created) ? created[0] : created) as HydratedDocument<IChatShellRunGroup>;

    const failGroup = async (msg: string) => {
        logStep(2, 'failGroup', { groupId: String(group._id), msg });
        await ModelChatShellRunGroup.findByIdAndUpdate(group._id, {
            $set: { status: 'error', errorReason: msg, updatedAtUtc: new Date() },
        });
    };

    logStep(2, 'group created', { groupId: String(group._id) });
    return { ok: true, data: { group, failGroup } };
}

async function shellStep3LoadConversation(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'convo' | 'latestUserText'> }> {
    const { threadId, username } = params;
    logStep(3, 'load recent messages');

    const recent = await ModelChatLlm.find({
        threadId,
        username,
        type: 'text',
    })
        .sort({ createdAtUtc: -1 })
        .limit(18)
        .lean();

    logStep(3, 'recent messages loaded', { count: recent.length });

    const chronological = [...recent].reverse();
    const convo = chronological
        .map((m) => `${m.isAi ? 'AI' : 'User'}: ${(m.content || '').slice(0, 4000)}`)
        .join('\n');

    const lastUser = await ModelChatLlm.findOne({
        threadId,
        username,
        isAi: false,
        type: 'text',
    })
        .sort({ createdAtUtc: -1 })
        .lean();

    const latestUserText = lastUser?.content?.trim() || '';
    logStep(3, 'convo + latest user', {
        convoLength: convo.length,
        latestUserTextLength: latestUserText.length,
        latestUserPreview: latestUserText.slice(0, 200),
    });

    return { ok: true, data: { convo, latestUserText } };
}

async function shellStep4ResolveLlmConfig(params: {
    threadId: mongoose.Types.ObjectId;
    failGroup: ShellRunCtx['failGroup'];
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'llmConfig'> } | { ok: false; error: string }> {
    const { threadId, failGroup } = params;
    logStep(4, 'getLlmConfig');

    const llmConfig = await getLlmConfig({ threadId });
    if (!llmConfig) {
        logStep(4, 'getLlmConfig returned null');
        await failGroup('No LLM configuration for decomposition');
        return { ok: false, error: 'Could not load LLM configuration for shell planning.' };
    }

    logStep(4, 'LLM config loaded', { provider: llmConfig.provider, model: llmConfig.model });
    return { ok: true, data: { llmConfig } };
}

async function shellStep5BuildTodoPlan(params: {
    llmConfig: LlmConfigNonNull;
    convo: string;
    latestUserText: string;
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'todos'> }> {
    const { llmConfig, convo, latestUserText } = params;
    logStep(5, 'planner fetchLlmUnified');

    const planMessages: Message[] = [
        {
            role: 'system',
            content:
                `You break down the user request into a small ordered list of tasks. Reply with ONLY a JSON array (no markdown), max ${SHELL_PLANNER_MAX_TODOS} objects. Each object: {"taskName": string, "executeStrategyBy": one of "llm","shellExecute","browserIntegration","internalKnowledgeAndLlm", "shellCommand": string, "verifyShellCommand"?: string}.\n` +
                'For **shellExecute** only, optional **verifyShellCommand**: a second single-line command that runs **after** shellCommand succeeds; it must **exit 0** (e.g. `test -f out.pdf`, `node -e "require(\'fs\').accessSync(\'report.html\')"`). Same validation rules as shellCommand. Omit verifyShellCommand if not needed.\n' +
                'ENVIRONMENT: shellExecute commands run on **Ubuntu 24.04 in Docker** with Node 24, npm, Python 3, pip, apt-get, build-essential, openssl, **chromium** (real binary at `/usr/bin/chromium`; **not** Ubuntu snap stub `chromium-browser`), ffmpeg, git, curl, and typical CLI tools — you may plan apt/npm/pip installs when needed.\n' +
                'TOOL ORDER: **Node.js first**, **Python 3 second** (only when Node is awkward), **other CLIs third** (e.g. chromium, curl) when the task clearly requires them.\n' +
                'CRITICAL routing rules for this chat (Execute shell is ON):\n' +
                '- You may **change the approach across steps**: e.g. first **shellExecute** only **writes** a script or data file into the thread workspace (materializing it in the sandbox), a later **shellExecute** **runs** that file (`bash ./x.sh`, `node ./y.js`), then more steps verify or convert output. Prefer several small shell steps over one huge line.\n' +
                '- If the user asks for hashes (MD5/SHA), checksums, encodings, small deterministic computation, file metadata/size, or anything verifiable with a short CLI command, you MUST set executeStrategyBy to "shellExecute" and provide a non-empty single-line shellCommand.\n' +
                '- **Files / images / rotation / ffmpeg / ImageMagick:** Do **not** invent filenames. Use the **exact** path or basename from `[Shell workspace: ...]` in the prompt, or from a prior `ls` / `ls -F` todo output. Example: `convert myphoto.jpg -rotate 90 myphoto_rotated.jpg` — not `input_file` or `output_file.png`.\n' +
                '- Use "internalKnowledgeAndLlm" or "llm" ONLY for pure reasoning that cannot be answered or verified by shell commands.\n' +
                '- Use "browserIntegration" only when the user explicitly needs a web browser.\n' +
                '- Prefer fewer shellExecute steps when possible; allow up to **14** shellExecute steps when you need install + write files + run + post-process pipelines.\n' +
                '- If the user wants a PDF but prefers not to depend on heavy installs, include an "llm" or "internalKnowledgeAndLlm" step for HTML/Markdown they can print to PDF in a browser.\n' +
                '- Every shellExecute shellCommand is validated: ONE physical line; no backticks; no real newlines; no unquoted | ; & at the outer shell level; no $ or ${ outside single-quoted spans (use bash -c \'...\' for inner scripts that need && or $). Semicolons inside node -e JavaScript are allowed while bash still sees you inside the opening ".\n' +
                '- For **datetime HTML → weasyprint** flows, prefer the **7c Node GOLDEN one-liner** from system guidance (not python3 -c with styled HTML — inner `"` break validation).\n' +
                '- **Install weasyprint**: apt step only (`apt-get ... weasyprint`); do not chain `pip install weasyprint` (PEP 668 / exit 1).\n' +
                'When executeStrategyBy is not "shellExecute", shellCommand and verifyShellCommand must be empty strings.\n' +
                SHELL_EXECUTE_COMMAND_GUIDANCE,
        },
        {
            role: 'user',
            content: `THREAD CONTEXT:\n${convo}\n\nLATEST USER MESSAGE:\n${latestUserText}\n\nReturn JSON array now.`,
        },
    ];

    const planLlm = await fetchLlmUnified({
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.model,
        messages: planMessages,
        temperature: 0.3,
        maxTokens: 2048,
        headersExtra: llmConfig.customHeaders,
    });

    logStep(5, 'planner LLM returned', {
        success: planLlm.success,
        contentLength: planLlm.content?.length ?? 0,
        contentPreview: planLlm.content?.trim().slice(0, 300),
    });

    let todos: ParsedTodo[] = [];
    if (planLlm.success && planLlm.content) {
        const arr = extractJsonArray(planLlm.content);
        if (arr) {
            todos = normalizeTodos(arr);
            logStep(5, 'extracted JSON array from planner', { rawLength: arr.length, normalizedCount: todos.length });
        } else {
            logStep(5, 'extractJsonArray returned null');
        }
    } else {
        logStep(5, 'skipped parse — planner missing success/content');
    }

    logStep(5, 'todos after planner', {
        count: todos.length,
        strategies: todos.map((t) => t.executeStrategyBy),
        hasRunnableShellTodo: hasRunnableShellTodo(todos),
    });

    if (!hasRunnableShellTodo(todos)) {
        logStep(5, 'fallback LLM first pass');
        let injected = await tryGenerateShellTodoWithLlm({
            llmConfig,
            latestUserText,
            convo,
            extraDirective: 'If the user request can be satisfied with one safe shell command, you must provide it.',
        });
        logStep(5, 'first fallback result', { injected: Boolean(injected) });
        if (!injected && looksComputeLike(latestUserText)) {
            logStep(5, 'fallback LLM second pass (compute-like)');
            injected = await tryGenerateShellTodoWithLlm({
                llmConfig,
                latestUserText,
                convo,
                extraDirective:
                    'The user message clearly implies a CLI hash, checksum, encoding, or similar deterministic computation. You MUST output a single-line shellCommand that performs it (e.g. Node crypto one-liner for string MD5).',
            });
            logStep(5, 'second fallback result', { injected: Boolean(injected) });
        }
        if (injected) {
            todos = [injected, ...todos];
            logStep(5, 'prepended injected shell todo', { newCount: todos.length });
        }
    } else {
        logStep(5, 'runnable shell todo present — skip fallback');
    }

    if (todos.length === 0) {
        logStep(5, 'default internalKnowledgeAndLlm todo');
        todos = [
            {
                taskName: 'Clarify and answer from context',
                executeStrategyBy: 'internalKnowledgeAndLlm',
                shellCommand: '',
            },
        ];
    }

    logStep(5, 'final todo list', {
        count: todos.length,
        items: todos.map((t) => ({
            taskName: t.taskName,
            executeStrategyBy: t.executeStrategyBy,
            shellCmdLen: (t.shellCommand || '').length,
        })),
    });

    return { ok: true, data: { todos } };
}

async function shellStep6PersistTodos(params: {
    todos: ParsedTodo[];
    group: HydratedDocument<IChatShellRunGroup>;
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'todoDocs'> }> {
    const { todos, group, threadId, username } = params;
    logStep(6, 'create ChatShellRunTodo rows');

    const todoDocs: mongoose.Types.ObjectId[] = [];
    for (let i = 0; i < todos.length; i++) {
        const t = todos[i];
        logStep(6, 'creating todo', { index: i, taskName: t.taskName, executeStrategyBy: t.executeStrategyBy });
        const doc = await ModelChatShellRunTodo.create({
            chatShellRunGroupId: group._id,
            threadId,
            username,
            executeStrategyBy: t.executeStrategyBy,
            taskName: t.taskName,
            shellCommand: t.shellCommand,
            verifyShellCommand: (t.verifyShellCommand || '').trim(),
            status: 'pending',
            orderIndex: i,
            attemptCount: 0,
            stdout: '',
            stderr: '',
            exitCode: null,
            verifyExitCode: null,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });
        todoDocs.push(doc._id as mongoose.Types.ObjectId);
    }
    logStep(6, 'all todo rows created', { todoDocIds: todoDocs.map(String) });
    return { ok: true, data: { todoDocs } };
}

async function shellStep7SummarizeNonShellTodos(params: {
    todos: ParsedTodo[];
    llmConfig: LlmConfigNonNull;
    convo: string;
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'nonShellSummary'> }> {
    const { todos, llmConfig, convo } = params;
    const nonShell = todos.filter((t) => t.executeStrategyBy !== 'shellExecute');
    let nonShellSummary = '';

    if (nonShell.length > 0) {
        logStep(7, 'batch fetchLlmUnified for non-shell', { nonShellCount: nonShell.length });
        const batchMessages: Message[] = [
            {
                role: 'system',
                content:
                    'You answer short research-style subtasks based on the thread. Reply with plain text bullet list only.',
            },
            {
                role: 'user',
                content: `CONTEXT:\n${convo}\n\nSUBTASKS:\n${nonShell
                    .map((t, i) => `${i + 1}. [${t.executeStrategyBy}] ${t.taskName}`)
                    .join('\n')}\n\nProvide concise bullets.`,
            },
        ];
        const batchLlm = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: batchMessages,
            temperature: 0.4,
            maxTokens: 2048,
            headersExtra: llmConfig.customHeaders,
        });
        nonShellSummary = batchLlm.success && batchLlm.content ? batchLlm.content.trim() : '(subtask LLM call failed)';
        logStep(7, 'batch LLM done', { success: batchLlm.success, summaryLength: nonShellSummary.length });
    } else {
        logStep(7, 'no non-shell todos — skip');
    }

    return { ok: true, data: { nonShellSummary } };
}

function shellStep8BuildFileStorageConfig(params: {
    userKeyDoc: HydratedDocument<IUserApiKey>;
    keys: ReturnType<typeof getApiKeyByObject>;
}): { ok: true; data: Pick<ShellRunCtx, 'storageType' | 's3Config'> } {
    const { userKeyDoc, keys } = params;
    logStep(8, 'file storage for shell imports');

    const storageType = userKeyDoc.fileStorageType === 's3' ? 's3' : 'gridfs';
    const s3Config: S3Config | undefined =
        storageType === 's3'
            ? {
                  region: keys.apiKeyS3Region || 'auto',
                  endpoint: keys.apiKeyS3Endpoint || '',
                  accessKeyId: keys.apiKeyS3AccessKeyId || '',
                  secretAccessKey: keys.apiKeyS3SecretAccessKey || '',
                  bucketName: keys.apiKeyS3BucketName || '',
              }
            : undefined;

    logStep(8, 'storage resolved', { storageType });
    return { ok: true, data: { storageType, s3Config } };
}

async function shellStep9ExecuteTodosAndImportFiles(params: {
    todos: ParsedTodo[];
    todoDocs: mongoose.Types.ObjectId[];
    apiBase: string;
    token: string;
    group: HydratedDocument<IChatShellRunGroup>;
    threadId: mongoose.Types.ObjectId;
    username: string;
    storageType: 's3' | 'gridfs';
    s3Config: S3Config | undefined;
    workspaceInputPaths: string[];
    shellPrimaryMinAttempt: number;
    shellPrimaryMaxAttempt: number;
    llmConfig: LlmConfigNonNull;
    convo: string;
    latestUserText: string;
}): Promise<{ ok: true; data: Pick<ShellRunCtx, 'shellLines' | 'fileLines' | 'shellFailureAppendix'> }> {
    const {
        todos,
        todoDocs,
        apiBase,
        token,
        group,
        threadId,
        username,
        storageType,
        s3Config,
        workspaceInputPaths,
        shellPrimaryMinAttempt,
        shellPrimaryMaxAttempt,
        llmConfig,
        convo,
        latestUserText,
    } = params;

    logStep(9, 'execute todo loop start', { todoCount: todos.length });
    const shellLines: string[] = [];
    const fileLines: string[] = [];
    let shellExecuteAttempted = false;
    let shellExecuteAllFailed = true;

    const threadDir = shellThreadWorkspaceRelativeDir(threadId);
    const initialListing = await fetchShellFileListing({
        apiBase,
        token,
        relativeDir: threadDir,
        maxFiles: 400,
    });
    const preSnapshot = fileMtimeMapFromListing(initialListing);
    const skipPaths = new Set(workspaceInputPaths.map((p) => p.replace(/\\/g, '/')));
    logStep(9, 'workspace snapshot', {
        threadDir,
        preFileCount: initialListing.length,
        skipInputCount: skipPaths.size,
    });

    for (let i = 0; i < todos.length; i++) {
        const t = todos[i];
        const todoId = todoDocs[i];

        logStep(9, 'todo iteration', {
            index: i,
            todoId: String(todoId),
            executeStrategyBy: t.executeStrategyBy,
            taskName: t.taskName,
        });

        if (t.executeStrategyBy !== 'shellExecute') {
            logStep(9, 'mark skipped', { index: i });
            await ModelChatShellRunTodo.findByIdAndUpdate(todoId, {
                $set: { status: 'skipped', updatedAtUtc: new Date() },
            });
            continue;
        }

        shellExecuteAttempted = true;

        const validated = validateShellCommand(t.shellCommand);
        if (!validated.ok) {
            logStep(9, 'rejected by validateShellCommand', { index: i, reason: validated.reason });
            await ModelChatShellRunTodo.findByIdAndUpdate(todoId, {
                $set: {
                    status: 'failed',
                    stderr: validated.reason,
                    verifyShellCommand: (t.verifyShellCommand || '').trim(),
                    attemptCount: 0,
                    verifyExitCode: null,
                    updatedAtUtc: new Date(),
                },
            });
            shellLines.push(
                `- **${t.taskName}** (rejected before run): ${validated.reason}\n  draft command (truncated): \`${clipShellOutput(t.shellCommand || '', 500)}\``,
            );
            continue;
        }
        const safeCmd = validated.cmd;
        const minAttempt = shellPrimaryMinAttempt;
        const maxAttempt = shellPrimaryMaxAttempt;
        let currentCmd = safeCmd;
        let timeoutMs = shellExecuteTimeoutMs(currentCmd);
        let axiosTimeoutMs = Math.min(240_000, timeoutMs + 60_000);
        const convoTail = convo.slice(-8000);

        logStep(9, 'POST execute (with retries + LLM revise)', {
            index: i,
            url: `${apiBase}/shell-engine/run-shell/execute`,
            commandPreview: currentCmd.slice(0, 200),
            timeoutMs,
            minAttempt,
            maxAttempt,
            cwd: threadDir,
        });

        const failedAttemptLog: string[] = [];
        let lastStdout = '';
        let lastStderr = '';
        let lastExitCode: number | null = null;
        let lastHttpOk = false;
        let lastTimedOut = false;
        let attemptsUsed = 0;
        let primarySuccess = false;

        for (let attempt = minAttempt; attempt <= maxAttempt; attempt++) {
            await ModelChatShellRunTodo.findByIdAndUpdate(todoId, {
                $set: { status: 'running', updatedAtUtc: new Date() },
            });

            const once = await postShellExecuteOnce({
                apiBase,
                token,
                threadDir,
                command: currentCmd,
                timeoutMs,
                axiosTimeoutMs,
            });
            attemptsUsed += 1;

            if (!once.ok) {
                lastStdout = '';
                lastStderr = once.message;
                lastExitCode = null;
                lastHttpOk = false;
                lastTimedOut = false;
                failedAttemptLog.push(
                    `[attempt ${attempt}/${maxAttempt}] axios/network error\n${once.message}`,
                );
                if (attempt < maxAttempt) {
                    const revised = await llmMaybeReviseShellCommandForRetry({
                        llmConfig,
                        taskName: t.taskName,
                        latestUserText,
                        convoTail,
                        originalPlannerCommand: safeCmd,
                        currentCommand: currentCmd,
                        attemptIndex: attempt,
                        maxAttempts: maxAttempt,
                        transportFailed: true,
                        stdout: '',
                        stderr: once.message,
                        exitCode: null,
                        timedOut: false,
                        httpOk: false,
                    });
                    if (revised) {
                        failedAttemptLog.push(
                            `[LLM retry strategy] using revised command before attempt ${attempt + 1}/${maxAttempt}: ${clipShellOutput(revised, 500)}`,
                        );
                        currentCmd = revised;
                        timeoutMs = shellExecuteTimeoutMs(currentCmd);
                        axiosTimeoutMs = Math.min(240_000, timeoutMs + 60_000);
                    }
                    await delay(SHELL_RETRY_BACKOFF_MS);
                    continue;
                }
                break;
            }

            lastStdout = once.stdout;
            lastStderr = once.stderr;
            lastExitCode = once.exitCode;
            lastHttpOk = once.httpOk;
            lastTimedOut = once.timedOut;

            const attemptOk = once.httpOk && once.exitCode === 0 && !once.timedOut;
            if (attemptOk) {
                primarySuccess = true;
                break;
            }
            failedAttemptLog.push(
                `[attempt ${attempt}/${maxAttempt}] exit=${once.exitCode} timedOut=${once.timedOut} httpOk=${once.httpOk}\n${clipShellOutput(`${once.stdout}\n${once.stderr}`, 2000)}`,
            );
            if (attempt < maxAttempt) {
                const revised = await llmMaybeReviseShellCommandForRetry({
                    llmConfig,
                    taskName: t.taskName,
                    latestUserText,
                    convoTail,
                    originalPlannerCommand: safeCmd,
                    currentCommand: currentCmd,
                    attemptIndex: attempt,
                    maxAttempts: maxAttempt,
                    transportFailed: false,
                    stdout: once.stdout,
                    stderr: once.stderr,
                    exitCode: once.exitCode,
                    timedOut: once.timedOut,
                    httpOk: once.httpOk,
                });
                if (revised) {
                    failedAttemptLog.push(
                        `[LLM retry strategy] using revised command before attempt ${attempt + 1}/${maxAttempt}: ${clipShellOutput(revised, 500)}`,
                    );
                    currentCmd = revised;
                    timeoutMs = shellExecuteTimeoutMs(currentCmd);
                    axiosTimeoutMs = Math.min(240_000, timeoutMs + 60_000);
                }
                await delay(SHELL_RETRY_BACKOFF_MS);
            }
        }

        const mergedPrimaryStderr =
            [...failedAttemptLog, lastStderr].filter((s) => s.trim()).join('\n---\n').slice(0, 50_000) ||
            lastStderr.slice(0, 50_000);

        let finalStatus: 'done' | 'failed' = 'failed';
        let finalStdout = lastStdout.slice(0, 50_000);
        let finalStderr = mergedPrimaryStderr;
        let finalExitCode = lastExitCode;
        let verifyExitCode: number | null = null;
        let verifyStdout = '';
        let verifyStderr = '';
        let verifyOk: boolean | undefined;
        let verifyFailureTimedOut = false;
        let verifyFailureHttpOk = false;
        const verifyRaw = (t.verifyShellCommand || '').trim();

        if (primarySuccess && verifyRaw) {
            const vv = validateShellCommand(verifyRaw);
            if (!vv.ok) {
                finalStatus = 'failed';
                verifyOk = false;
                verifyExitCode = null;
                verifyFailureTimedOut = false;
                verifyFailureHttpOk = false;
                finalStderr = `${mergedPrimaryStderr}\n[verify command rejected]\n${vv.reason}`.slice(0, 50_000);
            } else {
                const verifyTimeoutMs = shellExecuteTimeoutMs(vv.cmd);
                const verifyAxiosMs = Math.min(240_000, verifyTimeoutMs + 60_000);
                const vOnce = await postShellExecuteOnce({
                    apiBase,
                    token,
                    threadDir,
                    command: vv.cmd,
                    timeoutMs: verifyTimeoutMs,
                    axiosTimeoutMs: verifyAxiosMs,
                });
                if (!vOnce.ok) {
                    verifyOk = false;
                    verifyExitCode = null;
                    verifyStderr = vOnce.message;
                    verifyFailureTimedOut = false;
                    verifyFailureHttpOk = false;
                    finalStatus = 'failed';
                    finalStderr = `${mergedPrimaryStderr}\n[verify failed] axios\n${vOnce.message}`.slice(0, 50_000);
                } else {
                    verifyStdout = vOnce.stdout;
                    verifyStderr = vOnce.stderr;
                    verifyExitCode = vOnce.exitCode;
                    const vOk = vOnce.httpOk && vOnce.exitCode === 0 && !vOnce.timedOut;
                    verifyOk = vOk;
                    if (vOk) {
                        finalStatus = 'done';
                    } else {
                        finalStatus = 'failed';
                        verifyFailureTimedOut = vOnce.timedOut;
                        verifyFailureHttpOk = vOnce.httpOk;
                        finalStderr =
                            `${mergedPrimaryStderr}\n[verify failed] exit=${vOnce.exitCode} timedOut=${vOnce.timedOut} httpOk=${vOnce.httpOk}\n${(vOnce.stderr || vOnce.stdout || '').slice(0, 12_000)}`.slice(
                                0,
                                50_000,
                            );
                    }
                }
            }
        } else if (primarySuccess) {
            finalStatus = 'done';
            verifyOk = undefined;
        }

        if (finalStatus === 'done') {
            shellExecuteAllFailed = false;
        }

        await ModelChatShellRunTodo.findByIdAndUpdate(todoId, {
            $set: {
                status: finalStatus,
                stdout: finalStdout,
                stderr: finalStderr,
                exitCode: finalExitCode,
                attemptCount: attemptsUsed,
                verifyExitCode,
                updatedAtUtc: new Date(),
            },
        });

        logStep(9, 'todo DB updated after execute', {
            index: i,
            primarySuccess,
            finalStatus,
            attemptsUsed,
            hasVerify: Boolean(verifyRaw),
            verifyOk,
        });

        let summaryExitCode = lastExitCode;
        let summaryTimedOut = lastTimedOut;
        let summaryHttpOk = lastHttpOk;
        if (primarySuccess && !verifyRaw) {
            summaryExitCode = lastExitCode;
            summaryTimedOut = false;
            summaryHttpOk = true;
        } else if (primarySuccess && verifyRaw) {
            if (verifyOk === true) {
                summaryExitCode = lastExitCode;
                summaryTimedOut = false;
                summaryHttpOk = true;
            } else if (verifyOk === false) {
                summaryExitCode = verifyExitCode !== null && verifyExitCode !== undefined ? verifyExitCode : 1;
                summaryTimedOut = verifyFailureTimedOut;
                summaryHttpOk = verifyFailureHttpOk;
            }
        }

        shellLines.push(
            formatShellTodoResultLine({
                taskName: t.taskName,
                safeCmd: currentCmd,
                exitCode: summaryExitCode,
                stdout: finalStdout,
                stderr: finalStderr,
                timedOut: summaryTimedOut,
                httpOk: summaryHttpOk,
                primaryAttemptsUsed: attemptsUsed,
                primaryMaxAttempts: maxAttempt,
                verifyShellCommand: primarySuccess && verifyRaw ? verifyRaw : undefined,
                verifyOk: primarySuccess && verifyRaw ? verifyOk : undefined,
                verifyExitCode: primarySuccess && verifyRaw ? verifyExitCode : undefined,
                verifyStdout: primarySuccess && verifyRaw ? verifyStdout : undefined,
                verifyStderr: primarySuccess && verifyRaw ? verifyStderr : undefined,
            }),
        );

        if (finalStatus === 'done') {
            const combined = `${finalStdout}\n${finalStderr}`;
            const fromStdout = extractShellRelativePaths(combined);
            const postListing = await fetchShellFileListing({
                apiBase,
                token,
                relativeDir: threadDir,
                maxFiles: 400,
            });
            const fromScan = collectThreadWorkspaceOutputPaths({
                preSnapshot,
                currentListing: postListing,
                skipPaths,
            });
            const paths = [...new Set([...fromStdout, ...fromScan])];
            logStep(9, 'path scan', {
                fromStdout: fromStdout.length,
                fromScan: fromScan.length,
                merged: paths.length,
                paths,
            });

            for (const rel of paths) {
                const imp = await tryImportShellRelativeFile({
                    rel,
                    apiBase,
                    token,
                    group,
                    threadId,
                    username,
                    todoId,
                    storageType,
                    s3Config,
                    skipPaths,
                });
                if (imp.ok) {
                    fileLines.push(imp.fileLine);
                    const meta = postListing.find((f) => f.relativePath.replace(/\\/g, '/') === imp.normalizedPath);
                    preSnapshot.set(imp.normalizedPath, meta?.mtimeMs ?? Date.now());
                }
            }
        }
    }

    const shellFailureAppendix =
        shellExecuteAttempted && shellExecuteAllFailed && fileLines.length === 0
            ? [
                  '',
                  '**Why shell may have failed**',
                  '',
                  '- **apt / npm / pip**: Ubuntu **24.04**; **PEP 668** blocks system `pip install` — use **apt**, **npm**, or **`python3 -m venv .venv && .venv/bin/pip`**. For weasyprint, **apt package only**; drop `pip install weasyprint` from the install line.',
                  '- **PDF / heavy libs**: install in the **thread workspace** (shell cwd) before `require()` / imports. Use `bash -c \'...\'` when you need `&&` inside one shellExecute. Prefer **Node** to write HTML before weasyprint.',
                  '- **Fallback**: ask the model in normal chat for an **HTML** or **Markdown** version you can print to PDF in the browser, or split the work into smaller shell steps.',
                  '- **Exit 1 with no output**: often a broken `node -e` string (real newline inside the command, or `${` / `$` expanded by the shell). Commands must be one line; use `+` or `.join()` to build HTML in JavaScript.',
                  '- **Rejected before run (`;` / chaining)**: `python3 -c "..."` plus HTML with **`style="..."`** toggles bash double-quotes — use the **Node golden one-liner** from shell guidance (no `"` inside the HTML fragment) or `bash -c \'...\'`.',
                  '- **Python SyntaxError after backslash**: in `python3 -c "..."`, never use `strftime(\\\'...\\\')` or f-strings with mixed quotes — prefer the **Node** golden one-liner for HTML files.',
                  '- **weasyprint FileNotFoundError**: the HTML file must exist in the **same thread cwd**; the HTML step must **exit 0** before weasyprint (often failed because the prior step was rejected or used bad quoting).',
                  '- **ImageMagick `convert` / ffmpeg "No such file"**: the input path must be a **real basename** in the thread cwd (from `[Shell workspace: ...]` or `ls` output), not a placeholder like `input_file`.',
                  '- **Chromium / screenshot "requires the chromium snap"**: use **`chromium`** (or `/usr/bin/chromium`) with `--headless=new --no-sandbox --disable-dev-shm-usage`, not **`chromium-browser`** (Ubuntu snap stub; snap is not available in Docker).',
                  '- **HTTP error** on a step: the shell API rejected the request (bad cwd, auth, etc.) or returned an error body — the next line under stderr should show `[shell-engine HTTP …]` with the server message. Upgrade/restart the shell service if timeout caps mismatch.',
              ].join('\n')
            : '';

    logStep(9, 'execute loop finished', {
        shellLineCount: shellLines.length,
        fileLineCount: fileLines.length,
        shellFailureAppendixLen: shellFailureAppendix.length,
    });
    return { ok: true, data: { shellLines, fileLines, shellFailureAppendix } };
}

async function shellStep10WriteSummaryAndCompleteGroup(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    actionDatetimeObj: DefaultDateTimeIpAddress;
    group: HydratedDocument<IChatShellRunGroup>;
    nonShellSummary: string;
    shellLines: string[];
    fileLines: string[];
    shellFailureAppendix: string;
}): Promise<{ ok: true }> {
    const { threadId, username, actionDatetimeObj, group, nonShellSummary, shellLines, fileLines, shellFailureAppendix } =
        params;

    logStep(10, 'build summary message');
    const summaryBody = [
        '### Shell run',
        '',
        '**Plan (other strategies)**',
        nonShellSummary || '(none)',
        '',
        '**Shell commands**',
        shellLines.length ? shellLines.join('\n') : '(none)',
        '',
        '**Imported files**',
        fileLines.length ? fileLines.join('\n') : '(none)',
        shellFailureAppendix,
    ].join('\n');

    const artifactPlain = await buildShellRunArtifactV1({
        chatShellRunGroupId: group._id,
        threadId,
        username,
    });
    const shellRunArtifactV1 = mapPlainArtifactToChatSubdocument({ plain: artifactPlain });

    logStep(10, 'ModelChatLlm.create shell-run', {
        summaryBodyLength: summaryBody.length,
        artifactTodoCount: shellRunArtifactV1.todos.length,
        artifactFileCount: shellRunArtifactV1.importedFiles.length,
    });
    await ModelChatLlm.create({
        type: 'text',
        content: summaryBody,
        shellRunArtifactV1,
        username,
        threadId,
        isAi: true,
        tags: ['shell-run'],
        ...actionDatetimeObj,
    });

    await ModelChatShellRunGroup.findByIdAndUpdate(group._id, {
        $set: { status: 'completed', updatedAtUtc: new Date() },
    });
    logStep(10, 'group completed', { groupId: String(group._id) });
    return { ok: true };
}

export async function runChatShellForThread(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    actionDatetimeObj: DefaultDateTimeIpAddress;
}): Promise<{ success: true } | { success: false; error: string }> {
    const { threadId, username, actionDatetimeObj } = params;
    logStep(0, 'enter', { threadId: String(threadId), username });

    const s1 = await shellStep1LoadThreadAndKeys({ threadId, username });
    if (!s1.ok) {
        return { success: false, error: s1.error };
    }

    const s2 = await shellStep2CreateRunGroup({ threadId, username });
    const { group, failGroup } = s2.data;

    try {
        const s3 = await shellStep3LoadConversation({ threadId, username });
        const s4 = await shellStep4ResolveLlmConfig({ threadId, failGroup });
        if (!s4.ok) {
            return { success: false, error: s4.error };
        }

        const merged: ShellRunCtx = {
            threadId,
            username,
            actionDatetimeObj,
            ...s1.data,
            ...s2.data,
            ...s3.data,
            ...s4.data,
            todos: [],
            todoDocs: [],
            nonShellSummary: '',
            shellLines: [],
            fileLines: [],
            shellFailureAppendix: '',
            storageType: 'gridfs',
            s3Config: undefined,
        };

        const workspaceUpload = await uploadRecentUserFilesToShellWorkspace({
            threadId: merged.threadId,
            username: merged.username,
            apiBase: merged.apiBase,
            token: merged.token,
            userKeyDoc: merged.userKeyDoc,
            keys: merged.keys,
        });
        if (workspaceUpload.hintForPlanner) {
            logStep(3, 'upload user files to shell workspace', {
                paths: workspaceUpload.relativePaths,
            });
            merged.latestUserText = `${merged.latestUserText}\n\n${workspaceUpload.hintForPlanner}`.trim();
            merged.convo = `${merged.convo}\n\n${workspaceUpload.hintForPlanner}`.trim();
        }

        const threadWs = shellThreadWorkspaceRelativeDir(merged.threadId);
        const uploadBasenames = workspaceUpload.relativePaths
            .map((p) => p.split('/').pop() || p)
            .filter(Boolean);
        const outputDirHint =
            `[Shell workspace cwd is ${threadWs} (commands run here). Write NEW outputs as basenames in this folder (e.g. report.pdf, out.html) so they are imported. ` +
            (uploadBasenames.length
                ? `**Reference these uploaded files by exact basename in shellCommand** (same cwd): ${uploadBasenames.join(', ')}. Do not use placeholders like input_file or output_file.png.`
                : 'If the user attached a file, list with `ls -F` then use the real basename in convert/ffmpeg/node.') +
            ' Todos run in array order: you may use one shellExecute step only to materialize a file (e.g. run.sh or data.json), then a later shellExecute to run it (e.g. bash ./run.sh or node ./tool.js).]';
        if (!merged.latestUserText.includes('[Shell workspace cwd')) {
            merged.latestUserText = `${merged.latestUserText}\n\n${outputDirHint}`.trim();
            merged.convo = `${merged.convo}\n\n${outputDirHint}`.trim();
        }

        const s5 = await shellStep5BuildTodoPlan({
            llmConfig: merged.llmConfig,
            convo: merged.convo,
            latestUserText: merged.latestUserText,
        });
        merged.todos = s5.data.todos;

        const s6 = await shellStep6PersistTodos({
            todos: merged.todos,
            group: merged.group,
            threadId: merged.threadId,
            username: merged.username,
        });
        merged.todoDocs = s6.data.todoDocs;

        const s7 = await shellStep7SummarizeNonShellTodos({
            todos: merged.todos,
            llmConfig: merged.llmConfig,
            convo: merged.convo,
        });
        merged.nonShellSummary = s7.data.nonShellSummary;

        const s8 = shellStep8BuildFileStorageConfig({
            userKeyDoc: merged.userKeyDoc,
            keys: merged.keys,
        });
        merged.storageType = s8.data.storageType;
        merged.s3Config = s8.data.s3Config;

        const { minAttempt: shellPrimaryMinAttempt, maxAttempt: shellPrimaryMaxAttempt } =
            resolvePrimaryAttemptRangeFromThread(merged.thread);

        const s9 = await shellStep9ExecuteTodosAndImportFiles({
            todos: merged.todos,
            todoDocs: merged.todoDocs,
            apiBase: merged.apiBase,
            token: merged.token,
            group: merged.group,
            threadId: merged.threadId,
            username: merged.username,
            storageType: merged.storageType,
            s3Config: merged.s3Config,
            workspaceInputPaths: workspaceUpload.relativePaths,
            shellPrimaryMinAttempt,
            shellPrimaryMaxAttempt,
            llmConfig: merged.llmConfig,
            convo: merged.convo,
            latestUserText: merged.latestUserText,
        });
        merged.shellLines = s9.data.shellLines;
        merged.fileLines = s9.data.fileLines;
        merged.shellFailureAppendix = s9.data.shellFailureAppendix;

        await shellStep10WriteSummaryAndCompleteGroup({
            threadId: merged.threadId,
            username: merged.username,
            actionDatetimeObj: merged.actionDatetimeObj,
            group: merged.group,
            nonShellSummary: merged.nonShellSummary,
            shellLines: merged.shellLines,
            fileLines: merged.fileLines,
            shellFailureAppendix: merged.shellFailureAppendix,
        });

        return { success: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Shell run failed';
        logStep(0, 'catch', { msg, err: e });
        await failGroup(msg);
        return { success: false, error: msg };
    }
}

/**
 * Runs one validated shell command in the thread workspace (same `/shell-engine/run-shell/execute` API as chat shell).
 * The API parses the one-line string into `cmd` + `args` (`spawn`, no shell); the shell engine returns 200 + `exitCode` / `timedOut`.
 * Used by Answer Machine V3 `shell` sub-questions so arithmetic/tooling runs for real instead of LLM hallucination.
 *
 * Seeds recent user uploads into the sandbox (same paths as chat shell). When `answerMachineContext` is provided,
 * newly produced workspace files are imported into storage and recorded under `answerMachineFilesV3`.
 */
export async function executeAnswerMachineShellCommand(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    shellCommand: string;
    answerMachineContext?: {
        answerMachineRequestV3Id: mongoose.Types.ObjectId;
        answerMachineIteration?: number;
        answerMachineSubQuestionV3Id?: mongoose.Types.ObjectId | null;
    };
}): Promise<
    | {
          ok: true;
          stdout: string;
          stderr: string;
          exitCode: number | null;
          timedOut: boolean;
          httpOk: boolean;
          artifactSummaryAppendix: string;
      }
    | { ok: false; error: string }
> {
    const s1 = await shellStep1LoadThreadAndKeys({
        threadId: params.threadId,
        username: params.username,
    });
    if (!s1.ok) {
        return { ok: false, error: s1.error };
    }

    const validated = validateShellCommand(params.shellCommand);
    if (!validated.ok) {
        return { ok: false, error: validated.reason };
    }

    const threadDir = shellThreadWorkspaceRelativeDir(params.threadId);
    const workspaceUpload = await uploadRecentUserFilesToShellWorkspace({
        threadId: params.threadId,
        username: params.username,
        apiBase: s1.data.apiBase,
        token: s1.data.token,
        userKeyDoc: s1.data.userKeyDoc,
        keys: s1.data.keys,
    });

    const skipWorkspaceInputs = new Set(workspaceUpload.relativePaths);

    const listingBeforeExecute = await axios
        .get(`${s1.data.apiBase}/shell-engine/file/list`, {
            params: { relativeDir: threadDir, maxFiles: 400 },
            timeout: 60_000,
            headers: { 'X-API-Token': s1.data.token },
            validateStatus: () => true,
        })
        .catch(() => null);

    const preExecuteMtimes = new Map<string, number>();
    if (
        listingBeforeExecute &&
        listingBeforeExecute.status === 200 &&
        listingBeforeExecute.data &&
        typeof listingBeforeExecute.data === 'object'
    ) {
        const files = (listingBeforeExecute.data as { files?: unknown }).files;
        if (Array.isArray(files)) {
            for (const row of files) {
                if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
                const o = row as Record<string, unknown>;
                const rp = typeof o.relativePath === 'string' ? o.relativePath.replace(/\\/g, '/') : '';
                if (!rp) continue;
                const mtimeMs = typeof o.mtimeMs === 'number' ? o.mtimeMs : 0;
                preExecuteMtimes.set(rp, mtimeMs);
            }
        }
    }

    const timeoutMs = shellExecuteTimeoutMs(validated.cmd);
    const axiosTimeoutMs = Math.min(240_000, timeoutMs + 60_000);

    const once = await postShellExecuteOnce({
        apiBase: s1.data.apiBase,
        token: s1.data.token,
        threadDir,
        command: validated.cmd,
        timeoutMs,
        axiosTimeoutMs,
    });

    if (!once.ok) {
        return { ok: false, error: once.message };
    }

    let artifactSummaryAppendix = '';

    if (params.answerMachineContext) {
        const storageType = s1.data.userKeyDoc.fileStorageType === 's3' ? 's3' : 'gridfs';
        const k = s1.data.keys;
        const s3Config: S3Config | undefined =
            storageType === 's3'
                ? {
                      region: k.apiKeyS3Region || 'auto',
                      endpoint: k.apiKeyS3Endpoint || '',
                      accessKeyId: k.apiKeyS3AccessKeyId || '',
                      secretAccessKey: k.apiKeyS3SecretAccessKey || '',
                      bucketName: k.apiKeyS3BucketName || '',
                  }
                : undefined;

        const importedBatch = await importAnswerMachineOutputsAfterShellExecute({
            apiBase: s1.data.apiBase,
            token: s1.data.token,
            threadId: params.threadId,
            username: params.username,
            threadWorkspaceRelativeDir: threadDir,
            stdout: once.stdout,
            stderr: once.stderr,
            workspaceSkipPaths: skipWorkspaceInputs,
            preExecuteMtimes,
            storageType,
            s3Config,
            answerMachineRequestV3Id: params.answerMachineContext.answerMachineRequestV3Id,
            answerMachineIteration: params.answerMachineContext.answerMachineIteration,
            answerMachineSubQuestionV3Id: params.answerMachineContext.answerMachineSubQuestionV3Id ?? null,
        });
        artifactSummaryAppendix = importedBatch.summaryAppendix;
    }

    return {
        ok: true,
        stdout: once.stdout,
        stderr: once.stderr,
        exitCode: once.exitCode,
        timedOut: once.timedOut,
        httpOk: once.httpOk,
        artifactSummaryAppendix,
    };
}
