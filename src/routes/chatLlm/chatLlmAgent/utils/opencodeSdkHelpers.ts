/// <reference path="../../../../types/opencode-ai-sdk.d.ts" />

import type { OpencodeClient } from '@opencode-ai/sdk';
import type { tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';

export type OpencodeSdkClient = OpencodeClient;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let opencodeSdkModule: Promise<typeof import('@opencode-ai/sdk')> | undefined;

/**
 * Loads the ESM-only SDK from our CommonJS build output. Plain `import()` is compiled to
 * `require()` under `module: commonjs`, which breaks `@opencode-ai/sdk`; a runtime `import()`
 * keeps Node's native ESM loader.
 */
async function loadOpencodeSdk(): Promise<typeof import('@opencode-ai/sdk')> {
    if (!opencodeSdkModule) {
        const load = new Function('return import("@opencode-ai/sdk")') as () => Promise<
            typeof import('@opencode-ai/sdk')
        >;
        opencodeSdkModule = load();
    }
    return opencodeSdkModule;
}

/** Strip trailing slashes for a stable HTTP origin. */
export function normalizeOpencodeHttpBaseUrl(url: string): string {
    return (url || '').trim().replace(/\/+$/, '');
}

/**
 * Resolves the OpenCode server URL from user settings, then `OPENCODE_API_BASE_URL`, or empty string.
 * Mirrors logic used for REST calls elsewhere in the API.
 */
export function resolveOpencodeHttpBaseUrlFromUserApiKey(userApiKey: tsUserApiKey): string {
    const fromUser = (userApiKey.apiKeyOpencodeEndpoint || '').trim();
    if (fromUser.length >= 1) {
        return normalizeOpencodeHttpBaseUrl(fromUser);
    }
    const fromEnv = (process.env.OPENCODE_API_BASE_URL || '').trim();
    if (fromEnv.length >= 1) {
        return normalizeOpencodeHttpBaseUrl(fromEnv);
    }
    return '';
}

/**
 * Isolated workspace directory using a timestamp (matches ad-hoc scripts that use `/app/files-<ms>`).
 */
export function buildEphemeralOpencodeWorkspaceDirectory(): string {
    return `/app/files-${Date.now()}`;
}

function buildBasicAuthorizationHeader(username: string, password: string): string {
    return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

export interface CreateAuthenticatedOpencodeSdkClientParams {
    baseUrl: string;
    /** Server-side workspace root (OpenCode `directory` / `x-opencode-directory` scope). */
    workspaceDirectory: string;
    /** Optional API key sent as `x-api-key` / `x-opencode-api-key` (user `apiKeyOpencode`). */
    apiKey?: string;
    /** When password is non-empty, HTTP Basic auth is added. */
    basicAuth?: { username: string; password: string };
}

/**
 * Creates an `@opencode-ai/sdk` client scoped to a workspace directory, with optional API key
 * and Basic auth headers (same semantics as the REST/axios helpers).
 */
export async function createAuthenticatedOpencodeSdkClient(
    params: CreateAuthenticatedOpencodeSdkClientParams
): Promise<OpencodeSdkClient> {
    const { createOpencodeClient } = await loadOpencodeSdk();
    const baseUrl = normalizeOpencodeHttpBaseUrl(params.baseUrl);
    if (baseUrl.length < 1) {
        throw new Error('OpenCode baseUrl is empty');
    }
    const headers: Record<string, string> = {};
    const key = (params.apiKey || '').trim();
    if (key.length >= 1) {
        headers['x-api-key'] = key;
        headers['x-opencode-api-key'] = key;
    }
    const password = params.basicAuth?.password ?? '';
    if (password.length >= 1) {
        const username = (params.basicAuth?.username || 'opencode').trim() || 'opencode';
        headers.Authorization = buildBasicAuthorizationHeader(username, password);
    }
    return createOpencodeClient({
        baseUrl,
        directory: params.workspaceDirectory,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
    });
}

/**
 * Convenience: build client from `tsUserApiKey` and a workspace path. Returns `null` if no base URL is configured.
 */
export async function createAuthenticatedOpencodeSdkClientForUser(
    userApiKey: tsUserApiKey,
    workspaceDirectory: string
): Promise<OpencodeSdkClient | null> {
    const baseUrl = resolveOpencodeHttpBaseUrlFromUserApiKey(userApiKey);
    if (baseUrl.length < 1) {
        return null;
    }
    const passwordRaw = userApiKey.apiKeyOpencodeBasicAuthPassword || '';
    const usernameRaw = (userApiKey.apiKeyOpencodeBasicAuthUsername || '').trim();
    return createAuthenticatedOpencodeSdkClient({
        baseUrl,
        workspaceDirectory,
        apiKey: (userApiKey.apiKeyOpencode || '').trim(),
        basicAuth:
            passwordRaw.trim().length >= 1
                ? { username: usernameRaw || 'opencode', password: passwordRaw }
                : undefined,
    });
}

export function extractSessionIdFromOpencodeSessionCreate(
    res: Awaited<ReturnType<OpencodeSdkClient['session']['create']>>
): string {
    if (res.error) {
        return '';
    }
    const data = res.data as { id?: string; session?: { id?: string } } | undefined;
    if (!data) {
        return '';
    }
    if (typeof data.id === 'string' && data.id.length >= 1) {
        return data.id;
    }
    if (data.session && typeof data.session.id === 'string' && data.session.id.length >= 1) {
        return data.session.id;
    }
    return '';
}

/**
 * Creates a new OpenCode agent session and returns its id, or throws if creation fails.
 */
export async function createOpencodeAgentSessionId(client: OpencodeSdkClient): Promise<string> {
    const created = await client.session.create();
    const sessionId = extractSessionIdFromOpencodeSessionCreate(created);
    if (sessionId.length < 1) {
        throw new Error(
            `OpenCode session.create did not return a session id: ${JSON.stringify(created.error ?? created)}`
        );
    }
    return sessionId;
}

/**
 * Sets provider credentials (e.g. OpenRouter) on the OpenCode instance.
 * Tries `apiKey`, then `key`, then `token` (OpenCode / SDK versions vary).
 */
export async function configureOpencodeProviderApiKey(
    client: OpencodeSdkClient,
    providerId: string,
    secret: string
): Promise<void> {
    const attempts: Array<Record<string, string>> = [
        { apiKey: secret },
        { key: secret },
        { token: secret },
    ];
    let lastErr: unknown;
    for (const body of attempts) {
        try {
            await client.auth.set({
                path: { id: providerId },
                body,
            });
            return;
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('OpenCode auth.set failed for all body shapes');
}

export interface RunOpencodePtyBashCommandParams {
    /** Workspace directory (must match the client's `directory`). */
    workspaceDirectory: string;
    /** Shell command passed to `bash -lc`. */
    command: string;
    /** PTY title for logs. */
    title: string;
    /** Remote working directory for the PTY process (default `/app`). */
    remoteCwd?: string;
}

/**
 * Runs a one-shot bash command in a new PTY on the OpenCode host (e.g. `mkdir`, uploads via heredoc).
 */
export async function runOpencodePtyBashCommand(
    client: OpencodeSdkClient,
    params: RunOpencodePtyBashCommandParams
): Promise<unknown> {
    const res = await client.pty.create({
        query: { directory: params.workspaceDirectory },
        body: {
            command: 'bash',
            args: ['-lc', params.command],
            cwd: params.remoteCwd ?? '/app',
            title: params.title,
        },
    });
    if (res.error) {
        throw new Error(`PTY command failed (${params.title}): ${JSON.stringify(res.error)}`);
    }
    await sleep(300);
    return res.data;
}

export interface UploadBinaryToOpencodeWorkspaceViaPtyParams {
    workspaceDirectory: string;
    /** Path relative to the workspace root, POSIX segments (e.g. `uploads/report.pdf`). */
    relativePath: string;
    data: Buffer;
    /** PTY step title for logging. */
    title?: string;
    maxAttempts?: number;
}

/**
 * Writes binary data to a path inside the remote workspace by piping base64 through the shell (PTY).
 * Matches the working pattern from standalone OpenCode test scripts.
 */
export async function uploadBinaryToOpencodeWorkspaceViaPty(
    client: OpencodeSdkClient,
    params: UploadBinaryToOpencodeWorkspaceViaPtyParams
): Promise<void> {
    const rel = params.relativePath.replace(/\\/g, '/').replace(/^\//, '');
    const uploadAbsPath = `${params.workspaceDirectory.replace(/\/+$/, '')}/${rel}`;
    const uploadDirAbsPath = uploadAbsPath.replace(/\/[^/]+$/, '');
    const imageDataBase64 = params.data.toString('base64');
    const uploadCommand = [
        `mkdir -p "${uploadDirAbsPath}"`,
        `cat <<'__OPENCODE_UPLOAD_B64__' | base64 -d > "${uploadAbsPath}"`,
        imageDataBase64,
        '__OPENCODE_UPLOAD_B64__',
        `wc -c "${uploadAbsPath}"`,
    ].join('\n');

    const title = params.title ?? 'opencode-binary-upload';
    const maxAttempts = params.maxAttempts ?? 3;

    let uploadOk = false;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await runOpencodePtyBashCommand(client, {
                workspaceDirectory: params.workspaceDirectory,
                command: uploadCommand,
                title,
            });
            uploadOk = true;
            break;
        } catch (e) {
            lastError = e;
            const errMsg = e instanceof Error ? e.message : String(e);
            if (attempt === maxAttempts) {
                throw new Error(
                    `Upload through PTY failed after ${attempt} attempt(s): ${errMsg}`
                );
            }
            await sleep(800 * attempt);
        }
    }

    if (!uploadOk) {
        throw lastError instanceof Error
            ? lastError
            : new Error('Upload command did not complete successfully.');
    }
}
