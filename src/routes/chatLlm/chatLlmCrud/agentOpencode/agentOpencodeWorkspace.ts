import axios from 'axios';

import type { tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';
import { readBufferFromShellEngine, uploadBufferToShellEngine } from '../shellExecute/shellFileUpload';
import { AGENT_WORKSPACE_SHELL_PREFIX } from '../../../../utils/agentWorkspace/agentWorkspacePaths';

export type AgentOpencodeShellConfig = {
    baseUrl: string;
    token: string;
};

export const AGENT_OPENCODE_SHELL_FOLDER = 'agent-opencode';
export const AGENT_OPENCODE_SHELL_PREFIX = `${AGENT_WORKSPACE_SHELL_PREFIX}/${AGENT_OPENCODE_SHELL_FOLDER}`;

const hexId = (raw: string): string =>
    String(raw || 'unknown').replace(/[^a-fA-F0-9]/g, '').slice(0, 64) || 'unknown';

export const agentOpencodeThreadRoot = (threadId: string): string =>
    `${AGENT_OPENCODE_SHELL_PREFIX}/${hexId(threadId)}`;

export const agentOpencodeWorkspacePaths = ({
    threadId,
    instanceId,
}: {
    threadId: string;
    instanceId: string;
}): {
    root: string;
    inputDir: string;
    agentWorkspaceDir: string;
    outputDir: string;
    inputPrompt: string;
    outputPrompt: string;
    agentWorkspaceKeep: string;
    promptFileName: string;
    chatHistory: string;
    inputChatHistory: string;
    instructionFile: string;
    uploadsDir: string;
} => {
    const root = agentOpencodeThreadRoot(threadId);
    const promptFileName = `prompt-${hexId(instanceId)}.md`;
    const inputDir = `${root}/input`;
    const agentWorkspaceDir = `${root}/agent-workspace`;
    const outputDir = `${root}/output`;
    return {
        root,
        inputDir,
        agentWorkspaceDir,
        outputDir,
        inputPrompt: `${inputDir}/${promptFileName}`,
        outputPrompt: `${outputDir}/${promptFileName}`,
        agentWorkspaceKeep: `${agentWorkspaceDir}/.gitkeep`,
        promptFileName,
        chatHistory: `${agentWorkspaceDir}/CHAT.md`,
        inputChatHistory: `${inputDir}/CHAT.md`,
        instructionFile: `${agentWorkspaceDir}/INSTRUCTION.md`,
        uploadsDir: `${agentWorkspaceDir}/uploads`,
    };
};

export const getAgentOpencodeShellConfig = (
    apiKey: tsUserApiKey
): AgentOpencodeShellConfig | null => {
    if (
        apiKey.agentWorkspaceValid &&
        apiKey.agentWorkspaceApiUrl?.trim() &&
        apiKey.agentWorkspaceApiToken
    ) {
        return {
            baseUrl: apiKey.agentWorkspaceApiUrl.replace(/\/+$/, ''),
            token: apiKey.agentWorkspaceApiToken,
        };
    }
    const envUrl = process.env.AM4_SHELL_ENGINE_URL?.trim() || process.env.SHELL_ENGINE_URL?.trim();
    const envTok = process.env.AM4_SHELL_ENGINE_TOKEN?.trim() || process.env.SHELL_ENGINE_TOKEN?.trim();
    if (envUrl && envTok) {
        return { baseUrl: envUrl.replace(/\/+$/, ''), token: envTok };
    }
    return null;
};

const assertAgentOpencodeRelativePath = (relativePath: string): string => {
    const normalized = relativePath.split(/[/\\]/).join('/').replace(/\/+$/, '');
    if (!normalized || normalized === '.' || normalized.includes('..')) {
        throw new Error('Invalid Agent (Opencode) workspace path');
    }
    if (!normalized.startsWith(`${AGENT_OPENCODE_SHELL_PREFIX}/`)) {
        throw new Error(
            `Agent (Opencode) path must start with ${AGENT_OPENCODE_SHELL_PREFIX}/: ${normalized}`
        );
    }
    return normalized;
};

export const agentOpencodeWriteFile = async (params: {
    shell: AgentOpencodeShellConfig;
    relativePath: string;
    buffer: Buffer;
    mimeType?: string;
    timeoutMs?: number;
}): Promise<{ relativePath: string; absolutePath: string; size: number }> => {
    const relativePath = assertAgentOpencodeRelativePath(params.relativePath);
    const fileName = relativePath.split('/').pop() || 'file';
    const written = await uploadBufferToShellEngine({
        baseUrl: params.shell.baseUrl,
        token: params.shell.token,
        relativePath,
        buffer: params.buffer,
        fileName,
        mimeType: params.mimeType || 'text/markdown',
        timeoutMs: params.timeoutMs ?? 60_000,
    });
    if (!written.ok) {
        throw new Error(written.error || `Failed to write ${relativePath}`);
    }
    return {
        relativePath: written.relativePath,
        absolutePath: written.absolutePath,
        size: written.size,
    };
};

export const agentOpencodeReadFile = async (params: {
    shell: AgentOpencodeShellConfig;
    relativePath: string;
    timeoutMs?: number;
}): Promise<string> => {
    const relativePath = assertAgentOpencodeRelativePath(params.relativePath);
    const read = await readBufferFromShellEngine({
        baseUrl: params.shell.baseUrl,
        token: params.shell.token,
        relativePath,
        timeoutMs: params.timeoutMs ?? 60_000,
    });
    if (!read.ok) {
        throw new Error(read.error || `Failed to read ${relativePath}`);
    }
    return read.buffer.toString('utf8');
};

export type AgentOpencodeListedFile = {
    relativePath: string;
    pathInFolder: string;
    absolutePath: string;
    isDir: boolean;
    size: number;
};

export const agentOpencodeListDir = async (params: {
    shell: AgentOpencodeShellConfig;
    relativeDir: string;
    maxFiles?: number;
}): Promise<AgentOpencodeListedFile[]> => {
    const relativeDir = assertAgentOpencodeRelativePath(params.relativeDir);
    const res = await axios.get(`${params.shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/list`, {
        params: { relativeDir, maxFiles: params.maxFiles ?? 2000 },
        timeout: 30_000,
        headers: { 'X-API-Token': params.shell.token },
        validateStatus: () => true,
    });
    if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
        return [];
    }
    const raw = Array.isArray((res.data as { files?: unknown }).files)
        ? (res.data as { files: unknown[] }).files
        : [];
    const prefix = `${relativeDir}/`;
    const skipDirPart = (rel: string): boolean =>
        rel.split('/').some((part) => SKIP_UPLOAD_DIR_NAMES.has(part));
    return raw
        .map((item) => {
            if (!item || typeof item !== 'object') {
                return null;
            }
            const o = item as Record<string, unknown>;
            const rel = typeof o.relativePath === 'string' ? o.relativePath.replace(/\\/g, '/') : '';
            if (!rel) {
                return null;
            }
            const pathInFolder = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel === relativeDir ? '' : rel;
            if (skipDirPart(pathInFolder || rel)) {
                return null;
            }
            return {
                relativePath: rel,
                pathInFolder,
                absolutePath:
                    typeof o.absolutePath === 'string' && o.absolutePath.trim()
                        ? o.absolutePath.replace(/\\/g, '/')
                        : `/config/${rel}`,
                isDir: Boolean(o.isDir),
                size: typeof o.size === 'number' ? o.size : 0,
            };
        })
        .filter((x): x is AgentOpencodeListedFile => Boolean(x));
};

const SKIP_UPLOAD_DIR_NAMES = new Set(['node_modules', '.git', '.xdg-config', '.xdg-data']);
const SKIP_UPLOAD_FILE_NAMES = new Set(['.env', '.opencode-open-session.sh']);
const SKIP_UPLOAD_RELATIVE_FILES = new Set([
    'WEBHOOK.md',
    'opencode.json',
    '.opencode/opencode.json',
    '.opencode-stdout.json',
    '.opencode-stderr.log',
]);

const shouldSkipSecretRel = (relPosix: string, fileName: string): boolean =>
    SKIP_UPLOAD_FILE_NAMES.has(fileName) || SKIP_UPLOAD_RELATIVE_FILES.has(relPosix);

/** Copy remote agent-workspace files to a local folder (fixtures, prior outputs). */
export const agentOpencodeDownloadDirToLocal = async (params: {
    shell: AgentOpencodeShellConfig;
    remoteDir: string;
    localDir: string;
}): Promise<number> => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const files = await agentOpencodeListDir({
        shell: params.shell,
        relativeDir: params.remoteDir,
    });
    let count = 0;
    for (const file of files) {
        if (file.isDir || !file.pathInFolder) {
            continue;
        }
        const relPosix = file.pathInFolder.split(/[/\\]/).join('/');
        const fileName = relPosix.split('/').pop() || '';
        if (shouldSkipSecretRel(relPosix, fileName)) {
            continue;
        }
        const read = await readBufferFromShellEngine({
            baseUrl: params.shell.baseUrl,
            token: params.shell.token,
            relativePath: file.relativePath,
        });
        if (!read.ok) {
            continue;
        }
        const dest = path.join(params.localDir, ...relPosix.split('/'));
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, read.buffer);
        count += 1;
    }
    return count;
};

const mimeForFileName = (fileName: string): string => {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.md')) return 'text/markdown';
    if (lower.endsWith('.txt') || lower.endsWith('.json') || lower.endsWith('.ts') || lower.endsWith('.js')) {
        return 'text/plain';
    }
    return 'application/octet-stream';
};

/** Upload a local directory into the remote agent-workspace folder. */
export const agentOpencodeUploadLocalDir = async (params: {
    shell: AgentOpencodeShellConfig;
    localDir: string;
    remoteDir: string;
}): Promise<void> => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const remoteRoot = assertAgentOpencodeRelativePath(params.remoteDir);

    const walk = async (absDir: string, relDir: string): Promise<void> => {
        let entries: import('fs').Dirent[];
        try {
            entries = await fs.readdir(absDir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (SKIP_UPLOAD_DIR_NAMES.has(entry.name)) {
                continue;
            }
            const absPath = path.join(absDir, entry.name);
            const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
            const relPosix = relPath.split(path.sep).join('/');
            if (
                SKIP_UPLOAD_FILE_NAMES.has(entry.name) ||
                SKIP_UPLOAD_RELATIVE_FILES.has(relPosix)
            ) {
                continue;
            }
            if (entry.isDirectory()) {
                await walk(absPath, relPath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const buffer = await fs.readFile(absPath);
            await agentOpencodeWriteFile({
                shell: params.shell,
                relativePath: `${remoteRoot}/${relPath}`,
                buffer,
                mimeType: mimeForFileName(entry.name),
            });
        }
    };

    await walk(params.localDir, '');
};

const shellSingleQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const stripAnsi = (value: string): string =>
    value
        .replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '')
        .replace(/\u001B\][^\u0007]*\u0007/g, '');

/** Pull assistant text out of `opencode run --format json` lines; otherwise return cleaned stdout. */
export const parseOpencodeRunText = (stdout: string): string => {
    const raw = stripAnsi(stdout).replace(/\r/g, '').trim();
    if (!raw) {
        return '';
    }
    const texts: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) {
            continue;
        }
        try {
            const ev = JSON.parse(trimmed) as Record<string, unknown>;
            const type = typeof ev.type === 'string' ? ev.type : '';
            if (type === 'text' && ev.part && typeof ev.part === 'object') {
                const part = ev.part as Record<string, unknown>;
                if (typeof part.text === 'string' && part.text.trim()) {
                    texts.push(part.text);
                }
            }
            if (type === 'message' && typeof ev.content === 'string' && ev.content.trim()) {
                texts.push(ev.content);
            }
            if (typeof ev.text === 'string' && (type === 'text' || type === 'part.updated')) {
                texts.push(ev.text);
            }
        } catch {
            /* not a JSON event line */
        }
    }
    if (texts.length > 0) {
        return texts[texts.length - 1];
    }
    return raw;
};

const SESSION_ID_RE = /^ses_[A-Za-z0-9_-]+$/;

/** First OpenCode session id found in `opencode run --format json` stdout. */
export const parseOpencodeSessionId = (stdout: string): string => {
    const raw = stripAnsi(stdout).replace(/\r/g, '');
    if (!raw) {
        return '';
    }
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) {
            continue;
        }
        try {
            const ev = JSON.parse(trimmed) as Record<string, unknown>;
            const id =
                typeof ev.sessionID === 'string'
                    ? ev.sessionID
                    : typeof ev.sessionId === 'string'
                      ? ev.sessionId
                      : '';
            if (SESSION_ID_RE.test(id)) {
                return id;
            }
        } catch {
            /* not a JSON event line */
        }
    }
    const match = raw.match(/ses_[A-Za-z0-9_-]+/);
    return match && SESSION_ID_RE.test(match[0]) ? match[0] : '';
};

export const isOpencodeSessionId = (value: string): boolean => SESSION_ID_RE.test(String(value || '').trim());

export const agentOpencodeExecute = async (params: {
    shell: AgentOpencodeShellConfig;
    relativeDir: string;
    model: string;
    instruction: string;
    timeoutMs?: number;
    sessionId?: string;
    sessionTitle?: string;
}): Promise<{ stdout: string; stderr: string; ok: boolean; error?: string; sessionId: string }> => {
    const relativeDir = assertAgentOpencodeRelativePath(params.relativeDir);
    const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 300_000, 1), 600_000);
    const innerTimeoutSec = Math.max(30, Math.floor((timeoutMs - 10_000) / 1000));
    const model = String(params.model || '').trim() || 'openrouter/openai/gpt-oss-20b';
    const sessionId = isOpencodeSessionId(params.sessionId || '') ? String(params.sessionId).trim() : '';
    const sessionTitle = String(params.sessionTitle || '')
        .replace(/[\r\n"']/g, ' ')
        .trim()
        .slice(0, 80);

    const innerParts = [
        'opencode --pure run --auto --format json',
        `--model ${shellSingleQuote(model)}`,
        '--dir "$WORKDIR"',
    ];
    if (sessionId) {
        innerParts.push(`--session ${shellSingleQuote(sessionId)}`);
    } else if (sessionTitle) {
        innerParts.push(`--title ${shellSingleQuote(sessionTitle)}`);
    }
    innerParts.push('--');
    innerParts.push(shellSingleQuote(params.instruction));
    const innerRun = innerParts.join(' ');
    const command = [
        'export PATH="/root/.opencode/bin:/config/.opencode/bin:/usr/local/bin:$PATH"',
        'ROOT="${FILE_STORAGE_PATH:-/config}"',
        `export WORKDIR="$ROOT"/${shellSingleQuote(relativeDir)}`,
        'cd "$WORKDIR"',
        'export HOME="$WORKDIR"',
        'export XDG_CONFIG_HOME="$WORKDIR/.xdg-config"',
        'export XDG_DATA_HOME="$WORKDIR/.xdg-data"',
        'export OPENCODE_DISABLE_AUTOUPDATE=1',
        'export OPENCODE_DISABLE_DEFAULT_PLUGINS=1',
        'export CI=1',
        'mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"',
        'set -a',
        'if [ -f .env ]; then . ./.env; fi',
        'set +a',
        `timeout ${innerTimeoutSec}s script -q -c ${shellSingleQuote(innerRun)} /dev/null`,
    ].join(' && ');

    const base = params.shell.baseUrl.replace(/\/+$/, '');
    try {
        const execRes = await axios.post(
            `${base}/api/shell-engine/run-shell/execute`,
            { command, timeoutMs, treatStderrAsFailure: false },
            {
                timeout: timeoutMs + 20_000,
                headers: { 'X-API-Token': params.shell.token, 'Content-Type': 'application/json' },
                validateStatus: () => true,
            }
        );
        const body =
            execRes.data && typeof execRes.data === 'object'
                ? (execRes.data as Record<string, unknown>)
                : {};
        const stdout = typeof body.stdout === 'string' ? body.stdout : '';
        const stderr = typeof body.stderr === 'string' ? body.stderr : '';
        const parsedSessionId = parseOpencodeSessionId(stdout) || sessionId;
        if (stdout.trim()) {
            return { stdout, stderr, ok: true, sessionId: parsedSessionId };
        }
        const error =
            typeof body.message === 'string'
                ? body.message
                : typeof body.error === 'string'
                  ? body.error
                  : `OpenCode execute HTTP ${execRes.status}`;
        return { stdout, stderr, ok: false, error, sessionId: parsedSessionId };
    } catch (err) {
        return {
            stdout: '',
            stderr: '',
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            sessionId,
        };
    }
};

export const agentOpencodeOpenSessionOnDesktop = async (params: {
    shell: AgentOpencodeShellConfig;
    relativeDir: string;
    sessionId?: string;
    timeoutMs?: number;
}): Promise<{ ok: boolean; error?: string; sessionId: string; relativeDir: string; webUrl?: string }> => {
    const relativeDir = assertAgentOpencodeRelativePath(params.relativeDir);
    const sessionId = isOpencodeSessionId(params.sessionId || '') ? String(params.sessionId).trim() : '';
    const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 20_000, 1), 60_000);
    const base = params.shell.baseUrl.replace(/\/+$/, '');
    try {
        const openRes = await axios.post(
            `${base}/api/shell-engine/opencode/open-session`,
            { relativeDir, sessionId },
            {
                timeout: timeoutMs,
                headers: { 'X-API-Token': params.shell.token, 'Content-Type': 'application/json' },
                validateStatus: () => true,
            }
        );
        const body =
            openRes.data && typeof openRes.data === 'object'
                ? (openRes.data as Record<string, unknown>)
                : {};
        if (openRes.status === 200) {
            const webUrl = typeof body.webUrl === 'string' ? body.webUrl : undefined;
            return { ok: true, sessionId, relativeDir, webUrl };
        }
        const error =
            typeof body.message === 'string'
                ? body.message
                : typeof body.error === 'string'
                  ? body.error
                  : `Open session HTTP ${openRes.status}`;
        return { ok: false, error, sessionId, relativeDir };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            sessionId,
            relativeDir,
        };
    }
};

export const agentOpencodeDeleteThreadRoot = async (params: {
    shell: AgentOpencodeShellConfig;
    threadId: string;
    timeoutMs?: number;
}): Promise<{ ok: boolean; error?: string }> => {
    const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 30_000, 1), 120_000);
    let relativePath: string;
    try {
        relativePath = assertAgentOpencodeRelativePath(agentOpencodeThreadRoot(params.threadId));
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (relativePath === AGENT_OPENCODE_SHELL_PREFIX) {
        return { ok: false, error: 'Cannot delete the Agent (Opencode) workspace root' };
    }

    const base = params.shell.baseUrl.replace(/\/+$/, '');
    try {
        const deleteRes = await axios.post(
            `${base}/api/shell-engine/file/delete`,
            { relativePath },
            {
                timeout: timeoutMs,
                headers: { 'X-API-Token': params.shell.token, 'Content-Type': 'application/json' },
                validateStatus: () => true,
            }
        );
        if (deleteRes.status === 200) {
            return { ok: true };
        }

        const deleteCommand = [
            'ROOT="${FILE_STORAGE_PATH:-/config}"',
            `rm -rf -- "$ROOT"/${shellSingleQuote(relativePath)}`,
        ].join(' && ');

        const execRes = await axios.post(
            `${base}/api/shell-engine/run-shell/execute`,
            { command: deleteCommand, timeoutMs },
            {
                timeout: timeoutMs + 5_000,
                headers: { 'X-API-Token': params.shell.token, 'Content-Type': 'application/json' },
                validateStatus: () => true,
            }
        );
        if (execRes.status === 200) {
            return { ok: true };
        }

        return {
            ok: false,
            error: `Agent (Opencode) folder delete failed (HTTP ${deleteRes.status}/${execRes.status})`,
        };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
};
