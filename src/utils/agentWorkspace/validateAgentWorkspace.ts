import https from 'https';
import axios, { isAxiosError } from 'axios';

import { AGENT_WORKSPACE_APP } from './agentWorkspacePaths';

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

export type ValidateAgentWorkspaceOk = {
    ok: true;
    desktopOrigin: string;
    apiOrigin: string;
    token: string;
    username: string;
    password: string;
};

export type ValidateAgentWorkspaceErr = {
    ok: false;
    error: string;
};

function parseHttpOrigin(
    rawUrl: string,
    label: string,
    allowApiPath: boolean
): { origin: string } | { error: string } {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return { error: `${label} is required` };
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { error: `Invalid ${label}` };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { error: `${label} must use http or https` };
    }

    const pathNorm = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
    if (allowApiPath) {
        if (pathNorm !== '/' && pathNorm !== '/api') {
            return {
                error: `Use the ${label} origin only (e.g. http://localhost:2001/), not a subpath other than /api.`,
            };
        }
    } else if (pathNorm !== '/') {
        return {
            error: `Use the ${label} origin only (e.g. http://localhost:3010/), with no path after the host.`,
        };
    }

    return { origin: `${parsed.protocol}//${parsed.host}` };
}

function isAgentWorkspaceApp(payload: unknown): boolean {
    return (
        payload !== null &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        (payload as { app?: unknown }).app === AGENT_WORKSPACE_APP
    );
}

/**
 * Desktop: GET origin with HTTP Basic (CUSTOM_USER / PASSWORD).
 * API: public GET /api/shell-engine/about and token GET /about/private
 * (X-API-Token = API_TOKEN). App id must be ai-notes-xyz-agent-workspace.
 */
export async function validateAgentWorkspaceEndpoints(
    desktopUrl: string,
    desktopUsername: string,
    desktopPassword: string,
    apiUrl: string,
    apiToken: string
): Promise<ValidateAgentWorkspaceOk | ValidateAgentWorkspaceErr> {
    if (
        typeof desktopUrl !== 'string' ||
        typeof desktopUsername !== 'string' ||
        typeof desktopPassword !== 'string' ||
        typeof apiUrl !== 'string' ||
        typeof apiToken !== 'string'
    ) {
        return { ok: false, error: 'Invalid request body' };
    }

    const username = desktopUsername.trim();
    const password = desktopPassword;
    const token = apiToken.trim();

    if (!username || !password) {
        return {
            ok: false,
            error: 'Agent Workspace desktop username and password are required',
        };
    }

    if (!token) {
        return {
            ok: false,
            error: 'Agent Workspace API token is required',
        };
    }

    const desktopParsed = parseHttpOrigin(desktopUrl, 'Agent Workspace desktop URL', false);
    if ('error' in desktopParsed) {
        return { ok: false, error: desktopParsed.error };
    }

    const apiParsed = parseHttpOrigin(apiUrl, 'Agent Workspace API URL', true);
    if ('error' in apiParsed) {
        return { ok: false, error: apiParsed.error };
    }

    const desktopOrigin = desktopParsed.origin;
    const apiOrigin = apiParsed.origin;
    const apiBase = `${apiOrigin}/api`;

    try {
        const desktopRes = await axios.get<unknown>(desktopOrigin, {
            timeout: 12_000,
            auth: { username, password },
            maxRedirects: 5,
            validateStatus: () => true,
            httpsAgent: desktopOrigin.startsWith('https:') ? insecureHttpsAgent : undefined,
        });

        if (desktopRes.status === 401) {
            return {
                ok: false,
                error: `Agent Workspace desktop basic auth failed for ${desktopOrigin}/`,
            };
        }

        if (desktopRes.status < 200 || desktopRes.status >= 400) {
            return {
                ok: false,
                error: `Agent Workspace desktop check failed (HTTP ${desktopRes.status}) for ${desktopOrigin}/`,
            };
        }
    } catch (error) {
        if (isAxiosError(error)) {
            console.error('Agent Workspace desktop check:', error.message);
        } else {
            console.error(error);
        }
        return {
            ok: false,
            error: `Could not reach the Agent Workspace desktop at ${desktopOrigin}/`,
        };
    }

    try {
        const aboutRes = await axios.get<unknown>(`${apiBase}/shell-engine/about`, {
            timeout: 12_000,
            validateStatus: () => true,
        });

        if (!(aboutRes.status === 200 && isAgentWorkspaceApp(aboutRes.data))) {
            return {
                ok: false,
                error:
                    `Agent Workspace API validation failed. GET /api/shell-engine/about must return {"app":"${AGENT_WORKSPACE_APP}"} (e.g. curl -s http://localhost:2001/api/shell-engine/about).`,
            };
        }
    } catch (error) {
        if (isAxiosError(error)) {
            console.error('Agent Workspace public about check:', error.message);
        } else {
            console.error(error);
        }
        return {
            ok: false,
            error:
                'Could not reach the Agent Workspace API. Ensure ai-notes-xyz-agent-workspace is running at that origin (e.g. http://localhost:2001/).',
        };
    }

    try {
        const privateRes = await axios.get<unknown>(`${apiBase}/shell-engine/about/private`, {
            timeout: 12_000,
            headers: {
                'X-API-Token': token,
            },
            validateStatus: () => true,
        });

        if (privateRes.status === 503) {
            return {
                ok: false,
                error:
                    'Agent Workspace has no API_TOKEN configured. Set it in ai-notes-xyz-agent-workspace .env and restart (protected routes return 503 until then).',
            };
        }

        if (privateRes.status === 401) {
            return {
                ok: false,
                error:
                    'Invalid Agent Workspace API token. Use the same value as API_TOKEN in the X-API-Token header (see GET /api/shell-engine/about/private).',
            };
        }

        const privateOk =
            privateRes.status === 200 &&
            isAgentWorkspaceApp(privateRes.data) &&
            (privateRes.data as { validateToken?: unknown }).validateToken === true;

        if (!privateOk) {
            return {
                ok: false,
                error:
                    `Agent Workspace token check failed. GET /api/shell-engine/about/private must return 200 with {"app":"${AGENT_WORKSPACE_APP}","validateToken":true} when the token is valid.`,
            };
        }
    } catch (error) {
        if (isAxiosError(error)) {
            console.error('Agent Workspace private about check:', error.message);
        } else {
            console.error(error);
        }
        return {
            ok: false,
            error:
                'Could not reach the Agent Workspace API for the token check. Ensure ai-notes-xyz-agent-workspace is running.',
        };
    }

    return {
        ok: true,
        desktopOrigin,
        apiOrigin,
        token,
        username,
        password,
    };
}
