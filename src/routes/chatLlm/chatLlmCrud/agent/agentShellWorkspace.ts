import path from 'path';
import axios from 'axios';

import type { tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';
import { uploadBufferToShellEngine, readBufferFromShellEngine } from '../answerMachineV4/am4ShellFileUpload';

export type AgentShellConfig = {
    baseUrl: string;
    token: string;
};

/** Prefer dedicated Shell Engine; else OpenCode-with-Shell's shell URL (shell only, no OpenCode). */
export const getAgentShellConfig = (apiKey: tsUserApiKey): AgentShellConfig | null => {
    if (apiKey.shellEngineValid && apiKey.shellEngineUrl?.trim() && apiKey.shellEngineToken) {
        return {
            baseUrl: apiKey.shellEngineUrl.replace(/\/+$/, ''),
            token: apiKey.shellEngineToken,
        };
    }
    if (
        apiKey.opencodeWithCustomShellUrl?.trim() &&
        apiKey.opencodeWithCustomShellToken
    ) {
        return {
            baseUrl: apiKey.opencodeWithCustomShellUrl.replace(/\/+$/, ''),
            token: apiKey.opencodeWithCustomShellToken,
        };
    }
    const envUrl = process.env.AM4_SHELL_ENGINE_URL?.trim() || process.env.SHELL_ENGINE_URL?.trim();
    const envTok = process.env.AM4_SHELL_ENGINE_TOKEN?.trim() || process.env.SHELL_ENGINE_TOKEN?.trim();
    if (envUrl && envTok) {
        return { baseUrl: envUrl.replace(/\/+$/, ''), token: envTok };
    }
    return null;
};

/** Workspace root for an agent run: ai-notes-xyz/task/{id}/files */
export const agentTaskFilesDir = (taskId: string): string => {
    const safe = String(taskId || 'unknown').replace(/[^a-fA-F0-9]/g, '').slice(0, 64) || 'unknown';
    return `ai-notes-xyz/task/${safe}/files`;
};

export const agentTaskFilePath = (taskId: string, fileName: string): string => {
    const base = path.basename(String(fileName || 'file').replace(/\\/g, '/'));
    const safeName = base.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 180) || 'file';
    return `${agentTaskFilesDir(taskId)}/${safeName}`;
};

export const assertAgentTaskRelativePath = (relativePath: string): void => {
    const normalized = relativePath.split(/[/\\]/).join('/');
    if (!normalized.startsWith('ai-notes-xyz/task/')) {
        throw new Error(`Agent shell path must start with ai-notes-xyz/task/: ${normalized}`);
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
}): Promise<{ relativePath: string; absolutePath: string; size: number }> => {
    assertAgentTaskRelativePath(params.relativePath);
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
    return {
        relativePath: written.relativePath,
        absolutePath: written.absolutePath,
        size: written.size,
    };
};

export const shellReadFile = async (params: {
    shell: AgentShellConfig;
    relativePath: string;
    timeoutMs?: number;
}): Promise<Buffer> => {
    assertAgentTaskRelativePath(params.relativePath);
    const read = await readBufferFromShellEngine({
        baseUrl: params.shell.baseUrl,
        token: params.shell.token,
        relativePath: params.relativePath,
        timeoutMs: params.timeoutMs ?? 60_000,
    });
    if (!read.ok) {
        throw new Error(read.error || 'shell file read failed');
    }
    return read.buffer;
};

export const shellExecuteCommand = async (params: {
    shell: AgentShellConfig;
    command: string;
    timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string }> => {
    const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 60_000, 1), 120_000);
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
        const msg =
            typeof body.message === 'string'
                ? body.message
                : typeof body.error === 'string'
                  ? body.error
                  : `shell execute HTTP ${res.status}`;
        throw new Error(`${msg}${stderr ? `\n${stderr}` : ''}${stdout ? `\n${stdout}` : ''}`.slice(0, 2000));
    }
    return { stdout, stderr };
};

/** Quick reachability probe for the shell host. */
export const shellPing = async (shell: AgentShellConfig, timeoutMs = 5_000): Promise<boolean> => {
    try {
        const res = await axios.get(`${shell.baseUrl.replace(/\/+$/, '')}/api/`, {
            timeout: timeoutMs,
            validateStatus: () => true,
            headers: { 'X-API-Token': shell.token },
        });
        return res.status > 0 && res.status < 500;
    } catch {
        return false;
    }
};
