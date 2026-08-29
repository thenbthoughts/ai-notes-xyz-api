import path from 'path';
import axios from 'axios';

import type { tsUserApiKey } from '../../../../../../utils/llm/llmCommonFunc';
import { uploadBufferToShellEngine, readBufferFromShellEngine } from '../../../shellExecute/shellFileUpload';
import { writeAgentLogFromContext, type AgentLogContext } from '../agentWriteLog';
import { assertAgentShellSafe } from './agentShellSafety';
import {
    AGENT_WORKSPACE_ROOT,
    agentWorkspaceTaskFilesDir,
} from '../../../../../../utils/agentWorkspace/agentWorkspacePaths';

export type AgentShellConfig = {
    baseUrl: string;
    token: string;
};

export type AgentShellLogCtx = AgentLogContext;

/** Script printed OUT= and SIZE=<positive> — treat as success even if the shell HTTP status is not 200 (npm warn, allow-scripts). */
export const shellStdoutShowsDeliverable = (text: string): boolean => {
    const t = String(text || '');
    return /OUT\s*=\S/.test(t) && /SIZE\s*[:=]\s*[1-9]\d*/.test(t);
};

/** Agent Workspace API (shell + files). Env fallback for local tests. */
export const getAgentShellConfig = (apiKey: tsUserApiKey): AgentShellConfig | null => {
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

/** Workspace root for an agent run: ai-notes-xyz-agent-workspace/shell/agent/{chat_id} */
export const agentTaskFilesDir = (chatId: string): string => agentWorkspaceTaskFilesDir(chatId);

export const agentTaskFilePath = (chatId: string, fileName: string): string => {
    const base = path.basename(String(fileName || 'file').replace(/\\/g, '/'));
    const safeName = base.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 180) || 'file';
    return `${agentTaskFilesDir(chatId)}/${safeName}`;
};

export const assertAgentTaskRelativePath = (relativePath: string): void => {
    const normalized = relativePath.split(/[/\\]/).join('/');
    if (!normalized.startsWith(`${AGENT_WORKSPACE_ROOT}/`)) {
        throw new Error(`Agent shell path must start with ${AGENT_WORKSPACE_ROOT}/: ${normalized}`);
    }
    if (normalized.includes('..')) {
        throw new Error('Agent shell path must not contain ..');
    }
};

export const shellWriteFile = async (params: {
    shell: AgentShellConfig;
    relativePath: string;
    buffer: Buffer;
    fileName?: string;
    mimeType?: string;
    timeoutMs?: number;
    logCtx?: AgentShellLogCtx | null;
}): Promise<{ relativePath: string; absolutePath: string; size: number }> => {
    assertAgentTaskRelativePath(params.relativePath);
    const startedAt = Date.now();
    const shortName = path.basename(params.relativePath);
    await writeAgentLogFromContext(params.logCtx, {
        action: 'shell_upload',
        title: `Shell ↑ upload ${shortName}`,
        message: `Uploading ${params.relativePath} (${params.buffer.length} bytes)`,
        level: 'info',
        payload: {
            op: 'upload',
            relativePath: params.relativePath,
            fileName: params.fileName || shortName,
            mimeType: params.mimeType || 'application/octet-stream',
            sizeBytes: params.buffer.length,
            phase: 'start',
        },
        raw: {
            relativePath: params.relativePath,
            mimeType: params.mimeType || 'application/octet-stream',
            sizeBytes: params.buffer.length,
            // Text preview when likely text; otherwise note binary
            contentPreview:
                (params.mimeType || '').includes('json') ||
                (params.mimeType || '').includes('text') ||
                /\.(json|py|txt|md|js|ts|sh)$/i.test(shortName)
                    ? params.buffer.toString('utf8').slice(0, 30_000)
                    : `[binary ${params.buffer.length} bytes]`,
        },
    });
    try {
        const written = await uploadBufferToShellEngine({
            baseUrl: params.shell.baseUrl,
            token: params.shell.token,
            relativePath: params.relativePath,
            buffer: params.buffer,
            fileName: params.fileName || path.basename(params.relativePath),
            mimeType: params.mimeType || 'application/octet-stream',
            timeoutMs: params.timeoutMs ?? 60_000,
        });
        if (!written.ok) {
            throw new Error(written.error || 'shell file write failed');
        }
        await writeAgentLogFromContext(params.logCtx, {
            action: 'shell_upload',
            title: `Shell ↑ ${shortName} ok`,
            message: `Uploaded ${written.relativePath} (${written.size} bytes, ${Date.now() - startedAt}ms)`,
            level: 'info',
            payload: {
                op: 'upload',
                relativePath: written.relativePath,
                absolutePath: written.absolutePath,
                sizeBytes: written.size,
                durationMs: Date.now() - startedAt,
                phase: 'end',
            },
            raw: {
                relativePath: written.relativePath,
                absolutePath: written.absolutePath,
                sizeBytes: written.size,
            },
        });
        return {
            relativePath: written.relativePath,
            absolutePath: written.absolutePath,
            size: written.size,
        };
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await writeAgentLogFromContext(params.logCtx, {
            action: 'shell_error',
            title: `Shell ↑ ${shortName} failed`,
            message: `Upload failed: ${errMsg}`,
            level: 'error',
            payload: {
                op: 'upload',
                relativePath: params.relativePath,
                error: errMsg,
                durationMs: Date.now() - startedAt,
            },
            raw: { error: errMsg, stack: err instanceof Error ? err.stack : undefined },
        });
        throw err;
    }
};

export const shellReadFile = async (params: {
    shell: AgentShellConfig;
    relativePath: string;
    timeoutMs?: number;
    logCtx?: AgentShellLogCtx | null;
}): Promise<Buffer> => {
    assertAgentTaskRelativePath(params.relativePath);
    const startedAt = Date.now();
    const shortName = path.basename(params.relativePath);
    await writeAgentLogFromContext(params.logCtx, {
        action: 'shell_download',
        title: `Shell ↓ download ${shortName}`,
        message: `Downloading ${params.relativePath}`,
        level: 'info',
        payload: {
            op: 'download',
            relativePath: params.relativePath,
            phase: 'start',
        },
        raw: { relativePath: params.relativePath },
    });
    try {
        const read = await readBufferFromShellEngine({
            baseUrl: params.shell.baseUrl,
            token: params.shell.token,
            relativePath: params.relativePath,
            timeoutMs: params.timeoutMs ?? 60_000,
        });
        if (!read.ok) {
            throw new Error(read.error || 'shell file read failed');
        }
        await writeAgentLogFromContext(params.logCtx, {
            action: 'shell_download',
            title: `Shell ↓ ${shortName} ok`,
            message: `Downloaded ${params.relativePath} (${read.buffer.length} bytes, ${Date.now() - startedAt}ms)`,
            level: 'info',
            payload: {
                op: 'download',
                relativePath: params.relativePath,
                sizeBytes: read.buffer.length,
                durationMs: Date.now() - startedAt,
                phase: 'end',
            },
            raw: {
                relativePath: params.relativePath,
                sizeBytes: read.buffer.length,
                // Don't dump full xlsx binary into logs
                note: /\.xlsx$/i.test(shortName)
                    ? 'binary xlsx omitted from raw'
                    : 'binary content omitted from raw',
            },
        });
        return read.buffer;
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await writeAgentLogFromContext(params.logCtx, {
            action: 'shell_error',
            title: `Shell ↓ ${shortName} failed`,
            message: `Download failed: ${errMsg}`,
            level: 'error',
            payload: {
                op: 'download',
                relativePath: params.relativePath,
                error: errMsg,
                durationMs: Date.now() - startedAt,
            },
            raw: { error: errMsg, stack: err instanceof Error ? err.stack : undefined },
        });
        throw err;
    }
};

export const shellExecuteCommand = async (params: {
    shell: AgentShellConfig;
    command: string;
    timeoutMs?: number;
    logCtx?: AgentShellLogCtx | null;
    /** When executing a script file path — tags log as shell_execute_file */
    executeFilePath?: string;
}): Promise<{ stdout: string; stderr: string }> => {
    const safety = assertAgentShellSafe(params.command || '');
    if (!safety.ok) {
        throw new Error(`Shell safety: ${safety.reason || 'command blocked'}`);
    }

    const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 60_000, 1), 120_000);
    const startedAt = Date.now();
    const isFileExec = Boolean(params.executeFilePath);
    const action = isFileExec ? 'shell_execute_file' : 'shell_execute';
    const fileBase = params.executeFilePath
        ? path.basename(params.executeFilePath)
        : '';
    const titleStart = isFileExec
        ? `Shell ▶ run ${fileBase}`
        : `Shell ▶ execute`;

    await writeAgentLogFromContext(params.logCtx, {
        action,
        title: titleStart,
        message: isFileExec
            ? `Executing file ${params.executeFilePath}`
            : `Executing: ${params.command.slice(0, 200)}`,
        level: 'info',
        payload: {
            op: isFileExec ? 'execute_file' : 'execute',
            command: params.command.slice(0, 1000),
            executeFilePath: params.executeFilePath || '',
            timeoutMs,
            phase: 'start',
        },
        raw: {
            command: params.command,
            executeFilePath: params.executeFilePath || '',
            timeoutMs,
            shellBaseUrl: params.shell.baseUrl,
        },
    });

    try {
        const res = await axios.post(
            `${params.shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/run-shell/execute`,
            {
                command: params.command,
                timeoutMs,
            },
            {
                timeout: timeoutMs + 15_000,
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Token': params.shell.token,
                },
                validateStatus: () => true,
            },
        );
        const body = (res.data && typeof res.data === 'object' ? res.data : {}) as Record<string, unknown>;
        const stdout = typeof body.stdout === 'string' ? body.stdout : '';
        const stderr = typeof body.stderr === 'string' ? body.stderr : '';
        if (res.status !== 200) {
            const combined = `${stdout}\n${stderr}`;
            if (shellStdoutShowsDeliverable(combined)) {
                await writeAgentLogFromContext(params.logCtx, {
                    action,
                    title: isFileExec ? `Shell ▶ ${fileBase} ok` : `Shell ▶ execute ok`,
                    message: `Command finished with HTTP ${res.status} but printed OUT/SIZE (${Date.now() - startedAt}ms)`,
                    level: 'info',
                    payload: {
                        op: isFileExec ? 'execute_file' : 'execute',
                        command: params.command.slice(0, 1000),
                        executeFilePath: params.executeFilePath || '',
                        durationMs: Date.now() - startedAt,
                        httpStatus: res.status,
                        phase: 'end',
                        recoveredFromNon200: true,
                    },
                    raw: {
                        command: params.command,
                        executeFilePath: params.executeFilePath || '',
                        httpStatus: res.status,
                        stdout: stdout.slice(0, 50_000),
                        stderr: stderr.slice(0, 20_000),
                        responseBody: body,
                    },
                });
                return { stdout: combined, stderr };
            }
            const msg =
                typeof body.message === 'string'
                    ? body.message
                    : typeof body.error === 'string'
                      ? body.error
                      : `shell execute HTTP ${res.status}`;
            throw new Error(`${msg}${stderr ? `\n${stderr}` : ''}${stdout ? `\n${stdout}` : ''}`.slice(0, 2000));
        }

        await writeAgentLogFromContext(params.logCtx, {
            action,
            title: isFileExec ? `Shell ▶ ${fileBase} ok` : `Shell ▶ execute ok`,
            message: `Command finished in ${Date.now() - startedAt}ms`,
            level: 'info',
            payload: {
                op: isFileExec ? 'execute_file' : 'execute',
                command: params.command.slice(0, 1000),
                executeFilePath: params.executeFilePath || '',
                durationMs: Date.now() - startedAt,
                httpStatus: res.status,
                phase: 'end',
            },
            raw: {
                command: params.command,
                executeFilePath: params.executeFilePath || '',
                httpStatus: res.status,
                stdout: stdout.slice(0, 50_000),
                stderr: stderr.slice(0, 20_000),
                responseBody: body,
            },
        });
        return { stdout, stderr };
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await writeAgentLogFromContext(params.logCtx, {
            action: 'shell_error',
            title: isFileExec ? `Shell ▶ ${fileBase} failed` : `Shell ▶ execute failed`,
            message: errMsg.slice(0, 500),
            level: 'error',
            payload: {
                op: isFileExec ? 'execute_file' : 'execute',
                command: params.command.slice(0, 1000),
                executeFilePath: params.executeFilePath || '',
                error: errMsg.slice(0, 1500),
                durationMs: Date.now() - startedAt,
            },
            raw: {
                command: params.command,
                error: errMsg,
                stack: err instanceof Error ? err.stack : undefined,
            },
        });
        throw err;
    }
};

/** Quick reachability probe for the shell host. */
export const shellPing = async (
    shell: AgentShellConfig,
    timeoutMs = 5_000,
    logCtx?: AgentShellLogCtx | null,
): Promise<boolean> => {
    const startedAt = Date.now();
    await writeAgentLogFromContext(logCtx, {
        action: 'shell_ping',
        title: 'Shell ping',
        message: `Pinging ${shell.baseUrl}`,
        level: 'debug',
        payload: { op: 'ping', baseUrl: shell.baseUrl, phase: 'start' },
        raw: { baseUrl: shell.baseUrl, timeoutMs },
    });
    try {
        const res = await axios.get(`${shell.baseUrl.replace(/\/+$/, '')}/api/`, {
            timeout: timeoutMs,
            validateStatus: () => true,
            headers: { 'X-API-Token': shell.token },
        });
        const ok = res.status > 0 && res.status < 500;
        await writeAgentLogFromContext(logCtx, {
            action: 'shell_ping',
            title: ok ? 'Shell ping ok' : 'Shell ping failed',
            message: ok
                ? `HTTP ${res.status} in ${Date.now() - startedAt}ms`
                : `HTTP ${res.status} from ${shell.baseUrl}`,
            level: ok ? 'debug' : 'warn',
            payload: {
                op: 'ping',
                baseUrl: shell.baseUrl,
                status: res.status,
                ok,
                durationMs: Date.now() - startedAt,
                phase: 'end',
            },
            raw: {
                baseUrl: shell.baseUrl,
                status: res.status,
                headers: res.headers,
                data: typeof res.data === 'string' ? res.data.slice(0, 5000) : res.data,
            },
        });
        return ok;
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await writeAgentLogFromContext(logCtx, {
            action: 'shell_error',
            title: 'Shell ping error',
            message: errMsg,
            level: 'warn',
            payload: {
                op: 'ping',
                baseUrl: shell.baseUrl,
                error: errMsg,
                durationMs: Date.now() - startedAt,
            },
            raw: { error: errMsg, stack: err instanceof Error ? err.stack : undefined },
        });
        return false;
    }
};

const BLOCKED_SHELL_DELETE_ROOTS = new Set([
    AGENT_WORKSPACE_ROOT,
    `${AGENT_WORKSPACE_ROOT}/shell`,
    `${AGENT_WORKSPACE_ROOT}/features`,
]);

const assertDeletableShellRelativePath = (relativePath: string): void => {
    const normalized = relativePath.split(/[/\\]/).join('/').replace(/\/+$/, '');
    if (!normalized || normalized === '.' || normalized.includes('..')) {
        throw new Error('Invalid path');
    }
    if (BLOCKED_SHELL_DELETE_ROOTS.has(normalized)) {
        throw new Error('Cannot delete the workspace root');
    }
    if (!normalized.startsWith(`${AGENT_WORKSPACE_ROOT}/`)) {
        throw new Error('Path is not inside the Agent Workspace');
    }
};

const shellSingleQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const extractShellErrorMessage = (data: unknown, fallback: string): string => {
    if (data && typeof data === 'object') {
        const o = data as Record<string, unknown>;
        if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
        if (typeof o.error === 'string' && o.error.trim()) return o.error.trim();
        if (typeof o.stderr === 'string' && o.stderr.trim()) return o.stderr.trim();
    }
    return fallback;
};

/**
 * Delete a file or directory under the Agent Workspace (best-effort).
 * Tries file/delete, then falls back to `rm -rf` via run-shell/execute.
 */
export const shellDeleteRelativePath = async (params: {
    shell: AgentShellConfig;
    relativePath: string;
    timeoutMs?: number;
}): Promise<{ ok: boolean; error?: string }> => {
    const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 30_000, 1), 120_000);
    const relativePath = params.relativePath.replace(/\\/g, '/').replace(/\/+$/, '');
    try {
        assertDeletableShellRelativePath(relativePath);
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const base = params.shell.baseUrl.replace(/\/+$/, '');

    try {
        const shellRes = await axios.post(
            `${base}/api/shell-engine/file/delete`,
            { relativePath },
            {
                timeout: timeoutMs,
                headers: { 'X-API-Token': params.shell.token, 'Content-Type': 'application/json' },
                validateStatus: () => true,
            }
        );
        if (shellRes.status === 200) {
            return { ok: true };
        }

        // FILE_STORAGE_PATH is /config in ai-notes-xyz-agent-workspace. rm must target that root;
        // a bare relative path is a no-op when cwd is not the storage folder.
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

        const errMsg =
            extractShellErrorMessage(execRes.data, '') ||
            extractShellErrorMessage(shellRes.data, '') ||
            `Shell delete failed (HTTP ${shellRes.status}/${execRes.status})`;
        return { ok: false, error: errMsg };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
};

