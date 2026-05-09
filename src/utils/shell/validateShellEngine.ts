import axios, { isAxiosError } from 'axios';

export type ValidateShellEngineOk = {
    ok: true;
    origin: string;
    token: string;
};

export type ValidateShellEngineErr = {
    ok: false;
    error: string;
};

/**
 * Public GET /api/shell-engine/about and token GET /api/shell-engine/about/private.
 * Mirrors ai-notes-xyz-shell routes used by updateUserApiShellEngine.
 */
export async function validateShellEngineEndpoints(
    shellEngineUrl: string,
    shellEngineToken: string
): Promise<ValidateShellEngineOk | ValidateShellEngineErr> {
    if (typeof shellEngineUrl !== 'string' || typeof shellEngineToken !== 'string') {
        return { ok: false, error: 'Invalid request body' };
    }

    const rawUrl = shellEngineUrl.trim();
    const token = shellEngineToken.trim();

    if (!rawUrl || !token) {
        return { ok: false, error: 'Shell URL and token are required' };
    }

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { ok: false, error: 'Invalid shell service URL' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'URL must use http or https' };
    }

    const pathNorm = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
    if (pathNorm !== '/' && pathNorm !== '/api') {
        return {
            ok: false,
            error:
                'Use the shell server origin only (e.g. http://localhost:2001/), not a subpath other than /api.',
        };
    }

    const origin = `${parsed.protocol}//${parsed.host}`;
    const apiBase = `${origin}/api`;

    try {
        const aboutRes = await axios.get<unknown>(`${apiBase}/shell-engine/about`, {
            timeout: 12_000,
            validateStatus: () => true,
        });

        const payload = aboutRes.data;
        const isShellApp =
            aboutRes.status === 200 &&
            payload !== null &&
            typeof payload === 'object' &&
            !Array.isArray(payload) &&
            (payload as { app?: unknown }).app === 'ai-notes-xyz-shell';

        if (!isShellApp) {
            return {
                ok: false,
                error:
                    'Shell service validation failed. GET /api/shell-engine/about must return {"app":"ai-notes-xyz-shell"} (e.g. curl -s http://localhost:2001/api/shell-engine/about).',
            };
        }
    } catch (error) {
        if (isAxiosError(error)) {
            console.error('Shell engine public about check:', error.message);
        } else {
            console.error(error);
        }
        return {
            ok: false,
            error: 'Could not reach the shell service. Ensure ai-notes-xyz-shell is running at that origin (e.g. http://localhost:2001/).',
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
                    'Shell service has no API_TOKEN configured. Set API_TOKEN in ai-notes-xyz-shell .env and restart (protected routes return 503 until then).',
            };
        }

        if (privateRes.status === 401) {
            return {
                ok: false,
                error:
                    'Invalid shell token. Use the same value as API_TOKEN on ai-notes-xyz-shell in the X-API-Token header (see GET /api/shell-engine/about/private).',
            };
        }

        const privatePayload = privateRes.data;
        const privateOk =
            privateRes.status === 200 &&
            privatePayload !== null &&
            typeof privatePayload === 'object' &&
            !Array.isArray(privatePayload) &&
            (privatePayload as { app?: unknown }).app === 'ai-notes-xyz-shell' &&
            (privatePayload as { validateToken?: unknown }).validateToken === true;

        if (!privateOk) {
            return {
                ok: false,
                error:
                    'Shell token check failed. GET /api/shell-engine/about/private must return 200 with {"app":"ai-notes-xyz-shell","validateToken":true} when the token is valid.',
            };
        }
    } catch (error) {
        if (isAxiosError(error)) {
            console.error('Shell engine private about check:', error.message);
        } else {
            console.error(error);
        }
        return {
            ok: false,
            error: 'Could not reach the shell service for the token check. Ensure ai-notes-xyz-shell is running.',
        };
    }

    return { ok: true, origin, token };
}

/** OpenCode service: http(s) origin only, path must be / (no trailing path segments). */
export function parseOpenCodeServiceOrigin(rawUrl: string): { origin: string } | { error: string } {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return { error: 'OpenCode URL is required' };
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { error: 'Invalid OpenCode URL' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { error: 'URL must use http or https' };
    }

    const pathNorm = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
    if (pathNorm !== '/') {
        return {
            error: 'Use the OpenCode server origin only (e.g. https://opencode.example.com:4096/), with no path after the host.',
        };
    }

    return { origin: `${parsed.protocol}//${parsed.host}` };
}
