import axios from 'axios';
import type { tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';
import { AGENT_WORKSPACE_CONTAINER_STORAGE } from '../../../../utils/agentWorkspace/agentWorkspacePaths';
import type { AgentOpencodeShellConfig } from './agentOpencodeWorkspace';

export type OpencodeServerConfig = {
    baseUrl: string;
    username: string;
    password: string;
};

const normalizeBaseUrl = (raw: string): string => {
    const trimmed = String(raw || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    try {
        const withProto = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
        const u = new URL(withProto);
        return `${u.protocol}//${u.host}`.replace(/\/+$/, '');
    } catch {
        return trimmed;
    }
};

export const resolveOpencodeServerConfig = (apiKeys: tsUserApiKey): OpencodeServerConfig | null => {
    let base = (apiKeys.opencodeUrl || '').trim().replace(/\/+$/, '');
    if (!base) {
        const ws = (apiKeys.agentWorkspaceApiUrl || '').trim().replace(/\/+$/, '');
        if (ws) {
            try {
                const u = new URL(ws.includes('://') ? ws : `http://${ws}`);
                base = `${u.protocol}//${u.hostname}:4096`;
            } catch {
                base = '';
            }
        }
    }
    if (!base) {
        const env =
            (process.env.OPENCODE_SERVER_URL || '').trim() ||
            (process.env.OPENCODE_URL || '').trim() ||
            '';
        if (env) base = env.replace(/\/+$/, '');
    }
    base = normalizeBaseUrl(base);
    if (!base) return null;

    const username =
        (apiKeys.opencodeUsername || '').trim() ||
        (process.env.OPENCODE_SERVER_USERNAME || '').trim() ||
        'opencode';
    const password =
        (apiKeys.opencodePassword || '').trim() ||
        (process.env.OPENCODE_SERVER_PASSWORD || '').trim() ||
        '';

    return { baseUrl: base, username, password };
};

export const opencodeContainerDirectory = (relativeDir: string): string => {
    const rel = String(relativeDir || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    const root = (process.env.FILE_STORAGE_PATH || AGENT_WORKSPACE_CONTAINER_STORAGE || '/config').replace(/\/+$/, '') || '/config';
    return `${root}/${rel}`;
};

const buildAuthHeader = (username: string, password: string): string | null => {
    if (!password) return null;
    const user = username || 'opencode';
    return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
};

const opencodeHeaders = (
    config: OpencodeServerConfig,
    directory: string
): Record<string, string> => {
    const h: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    const auth = buildAuthHeader(config.username, config.password);
    if (auth) h['Authorization'] = auth;
    if (directory) {
        h['X-Opencode-Directory'] = directory;
    }
    return h;
};

const SESSION_ID_RE = /^ses_[A-Za-z0-9_-]+$/;
export const isOpencodeSessionId = (value: string): boolean => SESSION_ID_RE.test(String(value || '').trim());

export type OpencodeCreateSessionResult = { sessionId: string; raw?: unknown };
export type OpencodePromptResult = { text: string; parts: unknown[]; sessionId: string; raw?: unknown };

const extractSessionId = (data: unknown): string => {
    if (!data || typeof data !== 'object') return '';
    const obj = data as Record<string, unknown>;
    const candidates = [
        obj.id,
        obj.sessionId,
        obj.sessionID,
        (obj.session as Record<string, unknown> | undefined)?.id,
        (obj.data as Record<string, unknown> | undefined)?.id,
    ];
    for (const c of candidates) {
        if (typeof c === 'string' && SESSION_ID_RE.test(c.trim())) return c.trim();
    }
    return '';
};

const extractAssistantText = (data: unknown): { text: string; parts: unknown[] } => {
    if (!data || typeof data !== 'object') return { text: '', parts: [] };
    const obj = data as Record<string, unknown>;
    const partsRaw = Array.isArray(obj.parts) ? obj.parts : [];
    const texts: string[] = [];
    for (const p of partsRaw) {
        if (!p || typeof p !== 'object') continue;
        const part = p as Record<string, unknown>;
        if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
            texts.push(part.text);
        } else if (typeof (part as Record<string, unknown>).text === 'string' && String((part as Record<string, unknown>).text).trim()) {
            const t = String((part as Record<string, unknown>).text).trim();
            texts.push(t);
        }
    }
    if (texts.length > 0) {
        return { text: texts.join('\n\n'), parts: partsRaw };
    }
    const info = obj.info as Record<string, unknown> | undefined;
    if (info && typeof info.content === 'string' && info.content.trim()) {
        return { text: info.content.trim(), parts: partsRaw };
    }
    return { text: '', parts: partsRaw };
};

export const opencodeCreateSession = async (params: {
    config: OpencodeServerConfig;
    directory: string;
    title?: string;
    parentID?: string;
    timeoutMs?: number;
}): Promise<OpencodeCreateSessionResult> => {
    const { config, directory, title, parentID } = params;
    const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 30_000, 1), 60_000);
    const url = `${config.baseUrl.replace(/\/+$/, '')}/session`;
    const headers = opencodeHeaders(config, directory);
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const body: Record<string, unknown> = {};
    if (title) body.title = title;
    if (parentID && isOpencodeSessionId(parentID)) body.parentID = parentID;

    const res = await axios.post(`${url}${query}`, body, {
        timeout: timeoutMs,
        headers,
        validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) {
        const msg =
            (res.data && typeof res.data === 'object' && typeof (res.data as Record<string, unknown>).message === 'string'
                ? (res.data as Record<string, unknown>).message
                : '') ||
            (typeof res.data === 'string' ? res.data : '') ||
            `Create session HTTP ${res.status}`;
        throw new Error(String(msg).slice(0, 800) || `Create session failed HTTP ${res.status}`);
    }
    const sid = extractSessionId(res.data) || extractSessionId((res.data as Record<string, unknown>)?.data);
    if (!sid) {
        const fallback = typeof (res.data as Record<string, unknown>)?.id === 'string' ? String((res.data as Record<string, unknown>).id) : '';
        if (SESSION_ID_RE.test(fallback)) return { sessionId: fallback, raw: res.data };
        throw new Error('OpenCode did not return a session id');
    }
    return { sessionId: sid, raw: res.data };
};

export const opencodePromptSession = async (params: {
    config: OpencodeServerConfig;
    directory: string;
    sessionId: string;
    model: { providerID: string; modelID: string };
    parts: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }>;
    noReply?: boolean;
    agent?: string;
    timeoutMs?: number;
}): Promise<OpencodePromptResult> => {
    const { config, directory, sessionId, model, parts, noReply, agent } = params;
    const sid = String(sessionId || '').trim();
    if (!isOpencodeSessionId(sid)) throw new Error(`Invalid session id: ${sid}`);
    const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 300_000, 1), 600_000);

    const url = `${config.baseUrl.replace(/\/+$/, '')}/session/${encodeURIComponent(sid)}/message`;
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const headers = opencodeHeaders(config, directory);

    const body: Record<string, unknown> = {
        model: { providerID: model.providerID, modelID: model.modelID },
        parts,
    };
    if (noReply) body.noReply = true;
    if (agent) body.agent = agent;

    const res = await axios.post(`${url}${query}`, body, {
        timeout: timeoutMs + 20_000,
        headers,
        validateStatus: () => true,
    });

    if (noReply && res.status >= 200 && res.status < 300) {
        return { text: '', parts: [], sessionId: sid, raw: res.data };
    }

    if (res.status === 404) {
        throw new Error(`Session not found: ${sid}`);
    }
    if (res.status < 200 || res.status >= 300) {
        const msg =
            (res.data && typeof res.data === 'object' && typeof (res.data as Record<string, unknown>).message === 'string'
                ? (res.data as Record<string, unknown>).message
                : '') ||
            (typeof res.data === 'string' ? res.data : '') ||
            `Prompt HTTP ${res.status}`;
        throw new Error(String(msg).slice(0, 1200) || `Prompt failed HTTP ${res.status}`);
    }

    const { text, parts: outParts } = extractAssistantText(res.data);
    return { text, parts: outParts, sessionId: sid, raw: res.data };
};

export const opencodeGetSessionMessages = async (params: {
    config: OpencodeServerConfig;
    directory: string;
    sessionId: string;
    timeoutMs?: number;
}): Promise<{ messages: Array<{ info: unknown; parts: unknown[] }> }> => {
    const { config, directory, sessionId } = params;
    const sid = String(sessionId || '').trim();
    if (!isOpencodeSessionId(sid)) return { messages: [] };
    const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 30_000, 1), 60_000);
    const url = `${config.baseUrl.replace(/\/+$/, '')}/session/${encodeURIComponent(sid)}/message`;
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const headers = opencodeHeaders(config, directory);
    const res = await axios.get(`${url}${query}`, {
        timeout: timeoutMs,
        headers: { Authorization: headers['Authorization'] || '', 'X-Opencode-Directory': directory },
        validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) return { messages: [] };
    const data = res.data;
    if (Array.isArray(data)) return { messages: data as Array<{ info: unknown; parts: unknown[] }> };
    return { messages: [] };
};

// ---- Shell-based access (just access docker container and run commands) ----
// Runs curl inside the ai-notes-xyz-agent-workspace container via its shell-engine API.
// This avoids needing a separate Opencode URL/password tile in Settings — uses the
// container's localhost:4096 and its OPENCODE_SERVER_PASSWORD env.

const shellEscapeSingle = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

const runCurlViaShell = async (params: {
    shell: AgentOpencodeShellConfig;
    method: string;
    path: string;
    query?: string;
    body?: Record<string, unknown>;
    directory: string;
    timeoutMs?: number;
}): Promise<{ status: number; bodyText: string; bodyJson: unknown }> => {
    const { shell, method, path, query = '', body, directory } = params;
    const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 300_000, 1), 600_000);
    const innerTimeoutSec = Math.max(30, Math.floor((timeoutMs - 10_000) / 1000));

    const base = shell.baseUrl.replace(/\/+$/, '');
    const urlPath = `${path}${query}`;
    // Use container's localhost and its env password; do not expose password from API host
    const authPart = '-u "opencode:${OPENCODE_SERVER_PASSWORD:-password}"';
    const dirHeader = directory ? `-H ${shellEscapeSingle(`X-Opencode-Directory: ${directory}`)}` : '';
    const contentHeader = body ? `-H ${shellEscapeSingle('Content-Type: application/json')}` : '';

    let curlCmd: string;
    if (body) {
        const json = JSON.stringify(body);
        const b64 = Buffer.from(json, 'utf8').toString('base64');
        // Avoid shell quoting issues by base64-encoding the body
        curlCmd = `echo ${shellEscapeSingle(b64)} | base64 -d > /tmp/opencode_body.json && curl -s -w "\\n%{http_code}" ${authPart} ${contentHeader} ${dirHeader} http://localhost:4096${urlPath} -X ${method} --data-binary @/tmp/opencode_body.json --max-time ${innerTimeoutSec}`;
    } else {
        curlCmd = `curl -s -w "\\n%{http_code}" ${authPart} ${contentHeader} ${dirHeader} http://localhost:4096${urlPath} -X ${method} --max-time ${innerTimeoutSec}`;
    }

    // Wrap in timeout and capture stdout
    const command = `timeout ${innerTimeoutSec}s bash -c ${shellEscapeSingle(curlCmd)}`;

    const res = await axios.post(
        `${base}/api/shell-engine/run-shell/execute`,
        { command, timeoutMs, treatStderrAsFailure: false },
        {
            timeout: timeoutMs + 20_000,
            headers: { 'X-API-Token': shell.token, 'Content-Type': 'application/json' },
            validateStatus: () => true,
        }
    );

    const data = res.data && typeof res.data === 'object' ? (res.data as Record<string, unknown>) : {};
    const stdout = typeof data.stdout === 'string' ? data.stdout : '';
    const stderr = typeof data.stderr === 'string' ? data.stderr : '';

    if (res.status !== 200) {
        throw new Error(`Shell curl failed HTTP ${res.status}: ${stdout.slice(0, 500)} ${stderr.slice(0, 500)}`);
    }

    const trimmed = stdout.replace(/\r/g, '').trimEnd();
    if (!trimmed) {
        throw new Error(`Shell curl empty response (stderr: ${stderr.slice(0, 500)})`);
    }
    const lines = trimmed.split('\n');
    const statusStr = lines[lines.length - 1].trim();
    const status = parseInt(statusStr, 10);
    const bodyText = lines.slice(0, -1).join('\n');
    let bodyJson: unknown = null;
    try {
        bodyJson = bodyText ? JSON.parse(bodyText) : null;
    } catch {
        bodyJson = bodyText;
    }
    return { status: Number.isFinite(status) ? status : 0, bodyText, bodyJson };
};

export const opencodeCreateSessionViaShell = async (params: {
    shell: AgentOpencodeShellConfig;
    directory: string;
    title?: string;
    parentID?: string;
    timeoutMs?: number;
}): Promise<OpencodeCreateSessionResult> => {
    const { shell, directory, title, parentID } = params;
    const body: Record<string, unknown> = {};
    if (title) body.title = title;
    if (parentID && isOpencodeSessionId(parentID)) body.parentID = parentID;
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const { status, bodyText, bodyJson } = await runCurlViaShell({
        shell,
        method: 'POST',
        path: '/session',
        query,
        body,
        directory,
        timeoutMs: params.timeoutMs ?? 30_000,
    });
    if (status < 200 || status >= 300) {
        const msg =
            (bodyJson && typeof bodyJson === 'object' && typeof (bodyJson as Record<string, unknown>).message === 'string'
                ? (bodyJson as Record<string, unknown>).message
                : '') ||
            (typeof bodyJson === 'string' ? bodyJson : '') ||
            bodyText ||
            `Create session HTTP ${status}`;
        throw new Error(String(msg).slice(0, 800) || `Create session failed HTTP ${status}`);
    }
    const sid = extractSessionId(bodyJson) || extractSessionId((bodyJson as Record<string, unknown>)?.data);
    if (!sid) {
        const fallback = typeof (bodyJson as Record<string, unknown>)?.id === 'string' ? String((bodyJson as Record<string, unknown>).id) : '';
        if (SESSION_ID_RE.test(fallback)) return { sessionId: fallback, raw: bodyJson };
        throw new Error('OpenCode did not return a session id (via shell)');
    }
    return { sessionId: sid, raw: bodyJson };
};

export const opencodePromptSessionViaShell = async (params: {
    shell: AgentOpencodeShellConfig;
    directory: string;
    sessionId: string;
    model: { providerID: string; modelID: string };
    parts: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }>;
    noReply?: boolean;
    agent?: string;
    timeoutMs?: number;
}): Promise<OpencodePromptResult> => {
    const { shell, directory, sessionId, model, parts, noReply, agent } = params;
    const sid = String(sessionId || '').trim();
    if (!isOpencodeSessionId(sid)) throw new Error(`Invalid session id: ${sid}`);
    const body: Record<string, unknown> = {
        model: { providerID: model.providerID, modelID: model.modelID },
        parts,
    };
    if (noReply) body.noReply = true;
    if (agent) body.agent = agent;
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const { status, bodyText, bodyJson } = await runCurlViaShell({
        shell,
        method: 'POST',
        path: `/session/${encodeURIComponent(sid)}/message`,
        query,
        body,
        directory,
        timeoutMs: params.timeoutMs ?? 300_000,
    });

    if (noReply && status >= 200 && status < 300) {
        return { text: '', parts: [], sessionId: sid, raw: bodyJson };
    }
    if (status === 404) {
        throw new Error(`Session not found: ${sid}`);
    }
    if (status < 200 || status >= 300) {
        const msg =
            (bodyJson && typeof bodyJson === 'object' && typeof (bodyJson as Record<string, unknown>).message === 'string'
                ? (bodyJson as Record<string, unknown>).message
                : '') ||
            (typeof bodyJson === 'string' ? bodyJson : '') ||
            bodyText ||
            `Prompt HTTP ${status}`;
        throw new Error(String(msg).slice(0, 1200) || `Prompt failed HTTP ${status}`);
    }
    const { text, parts: outParts } = extractAssistantText(bodyJson);
    return { text, parts: outParts, sessionId: sid, raw: bodyJson };
};
