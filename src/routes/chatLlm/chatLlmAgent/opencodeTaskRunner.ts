import type mongoose from 'mongoose';

import { ModelChatLlmOpencodeTask } from '../../../schema/schemaChatLlm/SchemaChatLlmOpencodeTask.schema';
import type { tsUserApiKey } from '../../../utils/llm/llmCommonFunc';

import {
    resolveOpencodeHttpBaseUrlFromUserApiKey,
    runOpencodePtyBashCommand,
    type OpencodeSdkClient,
} from './utils/opencodeSdkHelpers';
import { persistOpencodeTaskOutputFile } from './opencodeArtifactPersist';
import {
    fetchOpencodeSessionMessageEntries,
    formatOpencodeMessageDeltaToTranscript,
    hasOpencodeAssistantOrToolActivity,
    hasOpencodeCompletedAssistantReply,
} from './opencodeSessionMessages';
import {
    bashSingleQuote,
    OPENCODE_THREAD_SUBDIR_CODEEXECUTION,
    OPENCODE_THREAD_SUBDIR_OUTPUTFILES,
} from './utils/opencodeWorkspacePaths';

const waitMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function opencodeWaitTimeoutMs(): number {
    const raw = (process.env.OPENCODE_SESSION_IDLE_TIMEOUT_MS || '').trim();
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(900_000, parsed) : 600_000;
}

/** If the OpenCode HTTP call never returns, the API request (and task) would hang forever without this. */
function opencodePromptAsyncTimeoutMs(): number {
    const raw = (process.env.OPENCODE_PROMPT_ASYNC_TIMEOUT_MS || '').trim();
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(600_000, parsed) : 180_000;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

function buildOpencodeExecutionSystemPrompt(workspaceDirectory: string): string {
    const ws = (workspaceDirectory || '').trim() || '(workspace root)';
    return [
        'You are operating inside OpenCode with shell/file tools available.',
        'Execute the task now. Do not merely describe what command should be run.',
        'Actually run installs, create files, and write outputs to disk.',
        'Prefer doing the work yourself instead of replying with advice or a plan.',
        'If the task mentions a binary artifact such as a PDF, ensure the real file is created before finishing.',
        `Workspace root: ${ws}`,
        `User-facing deliverables must end up under ${ws}/${OPENCODE_THREAD_SUBDIR_OUTPUTFILES} or ./${OPENCODE_THREAD_SUBDIR_OUTPUTFILES}.`,
        `Use ${ws}/${OPENCODE_THREAD_SUBDIR_CODEEXECUTION} for scratch scripts, installs, virtualenvs, and temporary work.`,
        'At the end, briefly summarize what you executed and which files were written.',
    ].join('\n');
}

async function waitForOpencodeExecutionStart(
    client: OpencodeSdkClient,
    workspaceDirectory: string,
    sdkSessionId: string
): Promise<boolean> {
    const maxWaitMs = 25_000;
    const pollMs = 2_500;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        const entries = await fetchOpencodeSessionMessageEntries(client, workspaceDirectory, sdkSessionId);
        if (hasOpencodeAssistantOrToolActivity(entries)) {
            return true;
        }
        await waitMs(pollMs);
    }
    return false;
}

async function isOpencodeSessionIdle(
    client: OpencodeSdkClient,
    workspaceDirectory: string,
    sdkSessionId: string
): Promise<boolean> {
    try {
        const res = await client.session.status({ query: { directory: workspaceDirectory } } as any);
        if ((res as any)?.error) {
            return false;
        }
        const map = (res as any)?.data;
        if (!map || typeof map !== 'object' || Array.isArray(map)) {
            return false;
        }
        const record = map as Record<string, { type?: string }>;
        const candidates = [sdkSessionId, sdkSessionId.toLowerCase(), sdkSessionId.toUpperCase()];
        for (const id of candidates) {
            const st = record[id];
            if (st && typeof st === 'object' && st.type === 'idle') {
                return true;
            }
        }
        const values = Object.values(record);
        if (values.length === 1 && values[0] && typeof values[0] === 'object' && values[0].type === 'idle') {
            return true;
        }
    } catch {
        return false;
    }
    return false;
}

/** Copy PDFs from codeexecution into outputfiles so they are picked up by list/read (agent often writes there first). */
async function copyPdfArtifactsFromCodeexecutionToOutputfiles(
    client: OpencodeSdkClient,
    workspaceDirectory: string
): Promise<void> {
    const q = bashSingleQuote(workspaceDirectory.replace(/\/+$/, ''));
    const out = OPENCODE_THREAD_SUBDIR_OUTPUTFILES;
    const ce = OPENCODE_THREAD_SUBDIR_CODEEXECUTION;
    const cmd = `mkdir -p ${q}/${out} && if [ -d ${q}/${ce} ]; then find ${q}/${ce} -type f \\( -iname '*.pdf' \\) -exec cp -f {} ${q}/${out}/ \\; 2>/dev/null || true; fi`;
    try {
        await runOpencodePtyBashCommand(client, {
            workspaceDirectory,
            command: cmd,
            title: 'opencode-copy-pdf-to-outputfiles',
            remoteCwd: '/app',
        });
    } catch {
        // best-effort
    }
}

function getEncoding(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const root = payload as Record<string, unknown>;
    const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
    const encoding = data.encoding;
    return typeof encoding === 'string' ? encoding : '';
}

function getContentType(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const root = payload as Record<string, unknown>;
    const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
    const contentType = data.mimeType || data.contentType || data.type;
    return typeof contentType === 'string' ? contentType : '';
}

function extractContentString(payload: unknown): string {
    if (typeof payload === 'string') return payload;
    if (!payload || typeof payload !== 'object') return '';
    const root = payload as Record<string, unknown>;
    const inner = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
    const c = inner.content;
    if (typeof c === 'string' && c.length >= 1) return c;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
        const nested = (c as Record<string, unknown>).data;
        if (typeof nested === 'string') return nested;
    }
    return '';
}

function fileLikelyBinaryBase64(fileName: string): boolean {
    return /\.(pdf|png|jpe?g|gif|webp|zip|bin)$/i.test(fileName);
}

function resolveMimeTypeForPersist(payload: unknown, fileName: string): string {
    const fromPayload = getContentType(payload);
    if (fromPayload && fromPayload !== 'binary' && fromPayload !== 'text') return fromPayload;
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.txt') || lower.endsWith('.py') || lower.endsWith('.md')) return 'text/plain; charset=utf-8';
    return 'application/octet-stream';
}

type ListedNode = { name: string; path: string; absolute?: string; type: 'file' | 'directory'; ignored: boolean };

const SKIP_WALK_DIRS = new Set([
    'node_modules',
    '.git',
    '.opencode',
    '__pycache__',
    '.venv',
    'venv',
    'dist',
    'build',
    '.next',
]);

const ARTIFACT_NAME_RE = /\.(pdf|txt|md|csv|png|jpe?g|gif|webp|docx?|xlsx?|html?|json|zip|bin)$/i;

const TINY_HELPER_PY_MAX_BYTES = 4096;

function taskExpectsPdf(task: { title: string; instruction: string }): boolean {
    const t = `${task.title || ''}\n${task.instruction || ''}`.toLowerCase();
    return t.includes('pdf');
}

function collectedHasPdf(files: Array<{ name: string }>): boolean {
    return files.some((f) => f.name.toLowerCase().endsWith('.pdf'));
}

/**
 * PDFs often appear a few seconds after the session reports "idle". When the user asked for a PDF,
 * keep syncing/copying and re-listing for a short window before we persist only helper .py files.
 */
async function collectArtifactsWithPdfGracePoll(
    client: OpencodeSdkClient,
    workspaceDirectory: string,
    expectsPdf: boolean,
    aggressiveGrace: boolean
): Promise<Array<{ name: string; path: string; absolute?: string }>> {
    await copyPdfArtifactsFromCodeexecutionToOutputfiles(client, workspaceDirectory);
    await syncAppFilesOutputIntoWorkspace(client, workspaceDirectory);
    let outputFiles = await collectArtifactFilesFromWorkspace(client, workspaceDirectory);

    if (!expectsPdf || collectedHasPdf(outputFiles)) {
        return outputFiles;
    }

    const extraRounds = aggressiveGrace ? 8 : 5;
    const pauseMs = 8_000;
    for (let i = 0; i < extraRounds; i++) {
        await waitMs(pauseMs);
        await copyPdfArtifactsFromCodeexecutionToOutputfiles(client, workspaceDirectory);
        await syncAppFilesOutputIntoWorkspace(client, workspaceDirectory);
        outputFiles = await collectArtifactFilesFromWorkspace(client, workspaceDirectory);
        if (collectedHasPdf(outputFiles)) {
            break;
        }
    }
    return outputFiles;
}

function parseFileListResponse(listRes: unknown): ListedNode[] {
    const wrap = listRes as { data?: unknown; error?: unknown };
    if (wrap && typeof wrap === 'object' && wrap.error) {
        return [];
    }
    const d = wrap?.data;
    if (!Array.isArray(d)) {
        return [];
    }
    const out: ListedNode[] = [];
    for (const raw of d) {
        if (!raw || typeof raw !== 'object') continue;
        const f = raw as Record<string, unknown>;
        const name = typeof f.name === 'string' ? f.name : '';
        const path = typeof f.path === 'string' ? f.path : '';
        const absolute = typeof f.absolute === 'string' && f.absolute.length >= 1 ? f.absolute : undefined;
        if (!name || !path) continue;
        let typ: 'file' | 'directory' = 'file';
        if (f.type === 'directory') typ = 'directory';
        else if (f.type === 'file') typ = 'file';
        const ignored = f.ignored === true;
        out.push({ name, path, absolute, type: typ, ignored });
    }
    return out;
}

async function listWorkspacePath(
    client: OpencodeSdkClient,
    workspaceDirectory: string,
    path: string
): Promise<ListedNode[]> {
    try {
        const listRes = await client.file.list({ query: { path, directory: workspaceDirectory } } as any);
        return parseFileListResponse(listRes);
    } catch {
        return [];
    }
}

/** Cheap fingerprint of likely deliverables (outputfiles + top-level codeexecution files). */
async function quickArtifactSignature(
    client: OpencodeSdkClient,
    workspaceDirectory: string
): Promise<string> {
    const parts: string[] = [];
    for (const p of [OPENCODE_THREAD_SUBDIR_OUTPUTFILES, OPENCODE_THREAD_SUBDIR_CODEEXECUTION]) {
        const nodes = await listWorkspacePath(client, workspaceDirectory, p);
        for (const n of nodes) {
            if (n.type === 'file' && !n.ignored) {
                parts.push(`${p}:${n.path}:${n.name}`);
            }
        }
    }
    return parts.sort().join('|');
}

/**
 * `promptAsync` returns immediately. Wait until the session reports idle and/or artifact listing stabilizes
 * so `file.read` sees complete files (status shape varies by OpenCode version).
 */
async function waitAfterOpencodePrompt(
    client: OpencodeSdkClient,
    workspaceDirectory: string,
    sdkSessionId: string,
    messageSliceStart: number
): Promise<{ timedOut: boolean; sawIdle: boolean; sawStableArtifacts: boolean; sawCompletedReply: boolean }> {
    const timeoutMs = opencodeWaitTimeoutMs();
    const pollMs = 2_500;
    const start = Date.now();
    await waitMs(4_000);

    let lastSig = '';
    let stableRounds = 0;
    let sawIdle = false;
    let sawStableArtifacts = false;
    let sawCompletedReply = false;

    while (Date.now() - start < timeoutMs) {
        const idle = await isOpencodeSessionIdle(client, workspaceDirectory, sdkSessionId);
        if (idle) {
            sawIdle = true;
        }

        const entries = await fetchOpencodeSessionMessageEntries(client, workspaceDirectory, sdkSessionId);
        const deltaEntries = entries.slice(messageSliceStart);
        if (hasOpencodeCompletedAssistantReply(deltaEntries)) {
            sawCompletedReply = true;
        }

        const sig = await quickArtifactSignature(client, workspaceDirectory);
        if (sig.length > 0 && sig === lastSig) {
            stableRounds++;
        } else {
            stableRounds = 0;
        }
        lastSig = sig;

        if (sig.length > 0 && stableRounds >= 2) {
            sawStableArtifacts = true;
        }

        if (sawIdle && (sig.length === 0 || stableRounds >= 1)) {
            return { timedOut: false, sawIdle, sawStableArtifacts, sawCompletedReply };
        }
        if (sawCompletedReply && (sig.length === 0 || stableRounds >= 1)) {
            return { timedOut: false, sawIdle, sawStableArtifacts, sawCompletedReply };
        }
        if (sawStableArtifacts && stableRounds >= 2) {
            return { timedOut: false, sawIdle, sawStableArtifacts, sawCompletedReply };
        }

        await waitMs(pollMs);
    }

    return { timedOut: true, sawIdle, sawStableArtifacts, sawCompletedReply };
}

function dedupePathCandidates(paths: Array<string | undefined>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of paths) {
        if (!p || p.length < 1) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        out.push(p);
    }
    return out;
}

function buildOpencodeHttpHeaders(userApiKey: tsUserApiKey, workspaceDirectory: string): Record<string, string> {
    const headers: Record<string, string> = {
        'x-opencode-directory': workspaceDirectory,
    };
    const apiKey = (userApiKey.apiKeyOpencode || '').trim();
    if (apiKey.length >= 1) {
        headers['x-api-key'] = apiKey;
        headers['x-opencode-api-key'] = apiKey;
    }
    const password = (userApiKey.apiKeyOpencodeBasicAuthPassword || '').trim();
    if (password.length >= 1) {
        const username = (userApiKey.apiKeyOpencodeBasicAuthUsername || 'opencode').trim() || 'opencode';
        headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
    }
    return headers;
}

async function readWorkspaceFileBytesViaHttp(
    userApiKey: tsUserApiKey,
    workspaceDirectory: string,
    file: { name: string; path: string; absolute?: string }
): Promise<{ ok: true; buf: Buffer; contentType: string } | { ok: false; detail: string }> {
    const baseUrl = resolveOpencodeHttpBaseUrlFromUserApiKey(userApiKey);
    if (baseUrl.length < 1) {
        return { ok: false, detail: 'OpenCode base URL is empty for HTTP fallback' };
    }
    const headers = buildOpencodeHttpHeaders(userApiKey, workspaceDirectory);
    const pathCandidates = dedupePathCandidates([file.path, file.absolute]);
    let lastDetail = 'no successful HTTP file/content fetch';
    for (const path of pathCandidates) {
        try {
            const url = `${baseUrl}/file/content?path=${encodeURIComponent(path)}`;
            const res = await fetch(url, { headers });
            if (!res.ok) {
                lastDetail = `HTTP ${res.status} ${res.statusText}`;
                continue;
            }
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const text = await res.text();
                try {
                    const parsed = JSON.parse(text) as Record<string, unknown>;
                    const encoding =
                        getEncoding(parsed) || (fileLikelyBinaryBase64(file.name) ? 'base64' : 'utf8');
                    const contentStr = extractContentString(parsed);
                    if (!contentStr) {
                        lastDetail = 'empty content in JSON HTTP response';
                        continue;
                    }
                    const buf =
                        encoding === 'base64' ? Buffer.from(contentStr, 'base64') : Buffer.from(contentStr, 'utf8');
                    if (!buf.length) {
                        lastDetail = 'decoded JSON buffer empty';
                        continue;
                    }
                    return {
                        ok: true,
                        buf,
                        contentType: resolveMimeTypeForPersist(parsed, file.name),
                    };
                } catch (e) {
                    lastDetail = `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`;
                    continue;
                }
            } else {
                // Binary response - use arrayBuffer
                const arrayBuffer = await res.arrayBuffer();
                const buf = Buffer.from(arrayBuffer);
                if (!buf.length) {
                    lastDetail = 'binary HTTP response empty';
                    continue;
                }
                return {
                    ok: true,
                    buf,
                    contentType: file.name.toLowerCase().endsWith('.pdf')
                        ? 'application/pdf'
                        : contentType || 'application/octet-stream',
                };
            }
        } catch (e) {
            lastDetail = e instanceof Error ? e.message : String(e);
        }
    }
    return { ok: false, detail: lastDetail };
}

async function readWorkspaceFileBytes(
    userApiKey: tsUserApiKey,
    client: OpencodeSdkClient,
    workspaceDirectory: string,
    file: { name: string; path: string; absolute?: string }
): Promise<{ ok: true; buf: Buffer; contentType: string } | { ok: false; detail: string }> {
    const norm = file.path.replace(/^\.\//, '');
    const pathCandidates = dedupePathCandidates([
        file.path,
        norm,
        norm.startsWith('/') ? norm : `/${norm}`,
        file.absolute,
        file.absolute?.replace(/^\.\//, ''),
    ]);

    let lastDetail = 'no successful file.read';
    for (const path of pathCandidates) {
        try {
            const readRes = await client.file.read({ query: { path, directory: workspaceDirectory } } as any);
            const wrap = readRes as Record<string, unknown>;
            if (wrap?.error) {
                lastDetail = typeof wrap.error === 'string' ? wrap.error : JSON.stringify(wrap.error);
                continue;
            }
            const payload = wrap?.data !== undefined ? wrap.data : readRes;
            const encoding =
                getEncoding(payload) ||
                (fileLikelyBinaryBase64(file.name) ? 'base64' : 'utf8');
            const contentStr = extractContentString(payload);
            if (!contentStr) {
                lastDetail = 'empty content in file.read response';
                continue;
            }
            const buf =
                encoding === 'base64' ? Buffer.from(contentStr, 'base64') : Buffer.from(contentStr, 'utf8');
            if (!buf.length) {
                lastDetail = 'decoded buffer empty';
                continue;
            }
            return {
                ok: true,
                buf,
                contentType: resolveMimeTypeForPersist(payload, file.name),
            };
        } catch (e) {
            lastDetail = e instanceof Error ? e.message : String(e);
        }
    }
    const viaHttp = await readWorkspaceFileBytesViaHttp(userApiKey, workspaceDirectory, file);
    if (viaHttp.ok) {
        return viaHttp;
    }
    return { ok: false, detail: `${lastDetail}; HTTP fallback: ${viaHttp.detail}` };
}

/**
 * Users often ask for /app/files-.../output; the OpenCode agent writes there while our workspace is
 * thread-scoped. Copy matching trees into workspace outputfiles so file.list + read can persist them.
 */
async function syncAppFilesOutputIntoWorkspace(
    client: OpencodeSdkClient,
    workspaceDirectory: string
): Promise<void> {
    const q = bashSingleQuote(workspaceDirectory.replace(/\/+$/, ''));
    const out = OPENCODE_THREAD_SUBDIR_OUTPUTFILES;
    const cmd = `mkdir -p ${q}/${out}; for d in /app/files-*/output; do if [ -d "$d" ]; then cp -f "$d"/* ${q}/${out}/ 2>/dev/null || true; fi; done`;
    try {
        await runOpencodePtyBashCommand(client, {
            workspaceDirectory,
            command: cmd,
            title: 'opencode-sync-app-output',
            remoteCwd: '/app',
        });
    } catch {
        // best-effort; collection still runs on workspace-only paths
    }
}

/**
 * Collect files under the workspace output area (several list path spellings + shallow tree walk).
 * If nothing is under an output folder, fall back to likely artifact extensions anywhere in the tree.
 */
async function collectArtifactFilesFromWorkspace(
    client: OpencodeSdkClient,
    workspaceDirectory: string
): Promise<Array<{ name: string; path: string; absolute?: string }>> {
    const files = new Map<string, { name: string; path: string; absolute?: string }>();
    const addFile = (n: ListedNode) => {
        if (n.type !== 'file' || n.ignored) return;
        files.set(n.path, {
            name: n.name,
            path: n.path,
            ...(n.absolute ? { absolute: n.absolute } : {}),
        });
    };

    const out = OPENCODE_THREAD_SUBDIR_OUTPUTFILES;
    const quickPaths = [
        out,
        `/${out}`,
        `./${out}`,
        out.charAt(0).toUpperCase() + out.slice(1),
        // legacy layouts
        'output',
        '/output',
        './output',
        'Output',
        '/Output',
    ];
    for (const p of quickPaths) {
        for (const n of await listWorkspacePath(client, workspaceDirectory, p)) {
            if (n.type === 'file') addFile(n);
        }
    }

    const walkOutputRelated = async (path: string, depth: number) => {
        if (depth > 14) return;
        const nodes = await listWorkspacePath(client, workspaceDirectory, path);
        for (const n of nodes) {
            if (n.ignored) continue;
            if (n.type === 'file') {
                const lower = n.path.toLowerCase();
                const inOutputfiles =
                    lower.includes(`/${out}/`) ||
                    lower.endsWith(`/${out}`) ||
                    lower.startsWith(`${out}/`) ||
                    lower.includes(`\\${out}\\`);
                const inLegacyOutput =
                    lower.includes('/output/') ||
                    lower.endsWith('/output') ||
                    lower.startsWith('output/') ||
                    lower.includes('\\output\\');
                if (inOutputfiles || inLegacyOutput) {
                    addFile(n);
                }
            } else if (n.type === 'directory') {
                if (SKIP_WALK_DIRS.has(n.name)) continue;
                await walkOutputRelated(n.path, depth + 1);
            }
        }
    };

    for (const root of ['.', '/', '']) {
        await walkOutputRelated(root, 0);
    }

    const ce = OPENCODE_THREAD_SUBDIR_CODEEXECUTION;
    const walkCodeexecutionArtifacts = async (path: string, depth: number) => {
        if (depth > 14 || files.size >= 80) return;
        const nodes = await listWorkspacePath(client, workspaceDirectory, path);
        for (const n of nodes) {
            if (n.ignored) continue;
            if (n.type === 'file') {
                if (ARTIFACT_NAME_RE.test(n.name)) addFile(n);
            } else if (n.type === 'directory') {
                if (SKIP_WALK_DIRS.has(n.name)) continue;
                await walkCodeexecutionArtifacts(n.path, depth + 1);
            }
        }
    };
    for (const ceRoot of [ce, `/${ce}`, `./${ce}`]) {
        await walkCodeexecutionArtifacts(ceRoot, 0);
    }

    if (files.size === 0) {
        const walkArtifacts = async (path: string, depth: number) => {
            if (depth > 14 || files.size >= 40) return;
            const nodes = await listWorkspacePath(client, workspaceDirectory, path);
            for (const n of nodes) {
                if (n.ignored) continue;
                if (n.type === 'file') {
                    if (ARTIFACT_NAME_RE.test(n.name)) addFile(n);
                } else if (n.type === 'directory') {
                    if (SKIP_WALK_DIRS.has(n.name)) continue;
                    await walkArtifacts(n.path, depth + 1);
                }
            }
        };
        for (const root of ['.', '/', '']) {
            await walkArtifacts(root, 0);
        }
    }

    return [...files.values()];
}

export async function executeOpencodeTaskList({
    username,
    threadId,
    userApiKey,
    client,
    workspaceDirectory,
    sdkSessionId,
    taskIds,
}: {
    username: string;
    threadId: mongoose.Types.ObjectId;
    userApiKey: tsUserApiKey;
    client: OpencodeSdkClient;
    workspaceDirectory: string;
    sdkSessionId: string;
    taskIds: mongoose.Types.ObjectId[];
}): Promise<{ summaryText: string; errorReason: string; outputFileRefs: any[] }> {
    const summaries: string[] = [];
    const aggregatedOutputFileRefs: any[] = [];
    let sessionMessageSliceStart = 0;
    for (const taskId of taskIds) {
        const task = await ModelChatLlmOpencodeTask.findOne({ _id: taskId, username, threadId });
        if (!task) {
            const nowSkip = new Date();
            await ModelChatLlmOpencodeTask.updateOne(
                { _id: taskId },
                {
                    $set: {
                        status: 'error',
                        errorReason: 'Task not found for this thread/user (cannot execute)',
                        updatedAtUtc: nowSkip,
                        runStartedAtUtc: null,
                        runFinishedAtUtc: nowSkip,
                    },
                }
            );
            summaries.push(`- (missing task ${String(taskId)}): skipped`);
            continue;
        }

        const runStart = new Date();
        await ModelChatLlmOpencodeTask.updateOne(
            { _id: taskId },
            {
                $set: {
                    status: 'running',
                    updatedAtUtc: runStart,
                    errorReason: '',
                    agentTranscript: '',
                    runStartedAtUtc: runStart,
                    runFinishedAtUtc: null,
                },
            }
        );

        try {
            const taskMessageSliceStart = sessionMessageSliceStart;
            const providerID = (process.env.OPENCODE_TASK_PROVIDER_ID || '').trim();
            const modelID = (process.env.OPENCODE_TASK_MODEL_ID || '').trim();

            await withTimeout(
                client.session.promptAsync({
                    path: { id: sdkSessionId },
                    body: {
                        system: buildOpencodeExecutionSystemPrompt(workspaceDirectory),
                        model:
                            providerID.length >= 1 && modelID.length >= 1
                                ? {
                                      providerID,
                                      modelID,
                                  }
                                : undefined,
                        parts: [{ type: 'text', text: task.instruction }],
                    },
                    query: { directory: workspaceDirectory },
                } as any) as Promise<unknown>,
                opencodePromptAsyncTimeoutMs(),
                'OpenCode session.promptAsync'
            );

            const executionStarted = await waitForOpencodeExecutionStart(
                client,
                workspaceDirectory,
                sdkSessionId
            );
            if (!executionStarted) {
                throw new Error(
                    'OpenCode stored the prompt but did not start assistant/tool activity within 25s'
                );
            }

            const idleWait = await waitAfterOpencodePrompt(
                client,
                workspaceDirectory,
                sdkSessionId,
                taskMessageSliceStart
            );
            const expectsPdf = taskExpectsPdf({ title: task.title, instruction: task.instruction });
            const aggressiveGrace = idleWait.timedOut && !idleWait.sawStableArtifacts;
            const outputFiles = await collectArtifactsWithPdfGracePoll(
                client,
                workspaceDirectory,
                expectsPdf,
                aggressiveGrace
            );

            const idleNote =
                idleWait.timedOut && !idleWait.sawStableArtifacts
                    ? ' (wait timed out before outputs stabilized; increase OPENCODE_SESSION_IDLE_TIMEOUT_MS if needed)'
                    : '';

            const hasPdfArtifact = collectedHasPdf(outputFiles);

            const persisted: any[] = [];
            let firstReadFailure = '';
            for (const f of outputFiles) {
                const read = await readWorkspaceFileBytes(userApiKey, client, workspaceDirectory, f);
                if (!read.ok) {
                    if (!firstReadFailure) firstReadFailure = read.detail;
                    console.error(`[opencode] Failed to read ${f.name} (${f.path}): ${read.detail}`);
                    continue;
                }
                const { buf, contentType } = read;

                if (
                    hasPdfArtifact &&
                    f.name.toLowerCase().endsWith('.py') &&
                    buf.length < TINY_HELPER_PY_MAX_BYTES
                ) {
                    continue;
                }
                if (
                    expectsPdf &&
                    !hasPdfArtifact &&
                    f.name.toLowerCase().endsWith('.py') &&
                    buf.length < TINY_HELPER_PY_MAX_BYTES
                ) {
                    continue;
                }

                const stored = await persistOpencodeTaskOutputFile({
                    username,
                    threadId,
                    userApiKey,
                    fileName: f.name,
                    contentType,
                    content: buf,
                });
                if (stored.success && stored.fileRef) {
                    persisted.push(stored.fileRef);
                    aggregatedOutputFileRefs.push(stored.fileRef);
                }
            }

            const readHint =
                persisted.length === 0 && outputFiles.length > 0 && firstReadFailure
                    ? ` — file.read: ${firstReadFailure}`
                    : '';

            let taskSummary: string;
            if (expectsPdf && !hasPdfArtifact && persisted.length === 0) {
                taskSummary = `No PDF was found under outputfiles/codeexecution after waiting. The agent may have only created a helper script — check "Instruction & agent messages" or raise OPENCODE_SESSION_IDLE_TIMEOUT_MS.${idleNote}${readHint}`;
            } else if (expectsPdf && !hasPdfArtifact && persisted.length > 0) {
                taskSummary = `Generated ${persisted.length} file(s), but no .pdf was detected in the workspace.${idleNote}`;
            } else if (persisted.length > 0) {
                taskSummary = `Generated ${persisted.length} file(s)${idleNote}`;
            } else if (outputFiles.length > 0) {
                taskSummary = `Completed (${outputFiles.length} file(s) on host; none stored — check OpenCode paths or read errors)${idleNote}${readHint}`;
            } else {
                taskSummary = `Completed${idleNote}`;
            }

            const allMessages = await fetchOpencodeSessionMessageEntries(client, workspaceDirectory, sdkSessionId);
            const delta = allMessages.slice(sessionMessageSliceStart);
            const agentTranscript = formatOpencodeMessageDeltaToTranscript(delta);
            sessionMessageSliceStart = allMessages.length;

            const runEnd = new Date();
            await ModelChatLlmOpencodeTask.updateOne(
                { _id: taskId },
                {
                    $set: {
                        status: 'done',
                        updatedAtUtc: runEnd,
                        summary: taskSummary,
                        outputFileRefs: persisted,
                        agentTranscript,
                        runFinishedAtUtc: runEnd,
                    },
                }
            );

            summaries.push(`- ${task.title}: done (${persisted.length} output file(s))`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            let agentTranscript = '';
            try {
                const allMessages = await fetchOpencodeSessionMessageEntries(
                    client,
                    workspaceDirectory,
                    sdkSessionId
                );
                const delta = allMessages.slice(sessionMessageSliceStart);
                agentTranscript = formatOpencodeMessageDeltaToTranscript(delta);
                sessionMessageSliceStart = allMessages.length;
            } catch {
                // best-effort transcript on failure
            }
            const runErrEnd = new Date();
            await ModelChatLlmOpencodeTask.updateOne(
                { _id: taskId },
                {
                    $set: {
                        status: 'error',
                        updatedAtUtc: runErrEnd,
                        errorReason: msg.slice(0, 800),
                        agentTranscript,
                        runFinishedAtUtc: runErrEnd,
                    },
                }
            );
            summaries.push(`- ${task.title}: error (${msg.slice(0, 140)})`);
        }
    }

    return { summaryText: summaries.join('\n').trim(), errorReason: '', outputFileRefs: aggregatedOutputFileRefs };
}

