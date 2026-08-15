import https from 'https';
import axios, { isAxiosError } from 'axios';

const LIBREOFFICE_APP = 'libreoffice-docker-web-with-api';

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

export type ValidateLibreOfficeOk = {
    ok: true;
    desktopOrigin: string;
    utilsOrigin: string;
    token: string;
    username: string;
    password: string;
};

export type ValidateLibreOfficeErr = {
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
                error: `Use the ${label} origin only (e.g. http://localhost:2000/), not a subpath other than /api.`,
            };
        }
    } else if (pathNorm !== '/') {
        return {
            error: `Use the ${label} origin only (e.g. http://localhost:3010/), with no path after the host.`,
        };
    }

    return { origin: `${parsed.protocol}//${parsed.host}` };
}

/**
 * Desktop: GET origin with HTTP Basic (CUSTOM_USER / PASSWORD).
 * Utils API: public GET /api/shell-engine/about and token GET /about/private
 * (X-API-Token = AI_NOTES_XYZ_LIBREOFFICE_API_TOKEN).
 */
export async function validateLibreOfficeEndpoints(
    libreOfficeUrl: string,
    libreOfficeBasicAuthUsername: string,
    libreOfficeBasicAuthPassword: string,
    libreOfficeUtilsUrl: string,
    libreOfficeUtilsToken: string
): Promise<ValidateLibreOfficeOk | ValidateLibreOfficeErr> {
    if (
        typeof libreOfficeUrl !== 'string' ||
        typeof libreOfficeBasicAuthUsername !== 'string' ||
        typeof libreOfficeBasicAuthPassword !== 'string' ||
        typeof libreOfficeUtilsUrl !== 'string' ||
        typeof libreOfficeUtilsToken !== 'string'
    ) {
        return { ok: false, error: 'Invalid request body' };
    }

    const username = libreOfficeBasicAuthUsername.trim();
    const password = libreOfficeBasicAuthPassword;
    const token = libreOfficeUtilsToken.trim();

    if (!username || !password) {
        return {
            ok: false,
            error: 'Libre Office basic auth username and password are required',
        };
    }

    if (!token) {
        return {
            ok: false,
            error: 'Ai Notes Xyz Libre Office Utils token is required',
        };
    }

    const desktopParsed = parseHttpOrigin(libreOfficeUrl, 'Libre Office URL', false);
    if ('error' in desktopParsed) {
        return { ok: false, error: desktopParsed.error };
    }

    const utilsParsed = parseHttpOrigin(
        libreOfficeUtilsUrl,
        'Ai Notes Xyz Libre Office Utils URL',
        true
    );
    if ('error' in utilsParsed) {
        return { ok: false, error: utilsParsed.error };
    }

    const desktopOrigin = desktopParsed.origin;
    const utilsOrigin = utilsParsed.origin;
    const apiBase = `${utilsOrigin}/api`;

    try {
        const desktopRes = await axios.get<unknown>(desktopOrigin, {
            timeout: 12_000,
            auth: { username, password },
            maxRedirects: 5,
            validateStatus: () => true,
            httpsAgent: desktopOrigin.startsWith('https:') ? insecureHttpsAgent : undefined,
        });

        console.log(desktopRes);

        if (desktopRes.status === 401) {
            return {
                ok: false,
                error:
                    'Libre Office basic auth failed. Use CUSTOM_USER and PASSWORD from ai-notes-xyz-libreoffice (desktop defaults: libreoffice / libreoffice) against the web desktop URL (e.g. http://localhost:3010/).',
            };
        }

        console.log(desktopRes);

        if (desktopRes.status < 200 || desktopRes.status >= 400) {
            return {
                ok: false,
                error: `Libre Office desktop check failed (HTTP ${desktopRes.status}). Use the web desktop origin (e.g. http://localhost:3010/ or https://localhost:3011/), not the utils API port.`,
            };
        }
    } catch (error) {
        if (isAxiosError(error)) {
            console.error('Libre Office desktop check:', error.message);
        } else {
            console.error(error);
        }
        return {
            ok: false,
            error:
                'Could not reach the Libre Office desktop. Ensure ai-notes-xyz-libreoffice is running (e.g. http://localhost:3010/).',
        };
    }

    try {
        const aboutRes = await axios.get<unknown>(`${apiBase}/shell-engine/about`, {
            timeout: 12_000,
            validateStatus: () => true,
        });

        const payload = aboutRes.data;
        const isLibreOfficeApp =
            aboutRes.status === 200 &&
            payload !== null &&
            typeof payload === 'object' &&
            !Array.isArray(payload) &&
            (payload as { app?: unknown }).app === LIBREOFFICE_APP;

        if (!isLibreOfficeApp) {
            return {
                ok: false,
                error:
                    'Libre Office utils validation failed. GET /api/shell-engine/about must return {"app":"libreoffice-docker-web-with-api"} (e.g. curl -s http://localhost:2000/api/shell-engine/about).',
            };
        }
    } catch (error) {
        if (isAxiosError(error)) {
            console.error('Libre Office utils public about check:', error.message);
        } else {
            console.error(error);
        }
        return {
            ok: false,
            error:
                'Could not reach the Libre Office utils API. Ensure ai-notes-xyz-libreoffice is running at that origin (e.g. http://localhost:2000/).',
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
                    'Libre Office utils has no AI_NOTES_XYZ_LIBREOFFICE_API_TOKEN configured. Set it in ai-notes-xyz-libreoffice .env and restart (protected routes return 503 until then).',
            };
        }

        if (privateRes.status === 401) {
            return {
                ok: false,
                error:
                    'Invalid Libre Office utils token. Use the same value as AI_NOTES_XYZ_LIBREOFFICE_API_TOKEN in the X-API-Token header (see GET /api/shell-engine/about/private).',
            };
        }

        const privatePayload = privateRes.data;
        const privateOk =
            privateRes.status === 200 &&
            privatePayload !== null &&
            typeof privatePayload === 'object' &&
            !Array.isArray(privatePayload) &&
            (privatePayload as { app?: unknown }).app === LIBREOFFICE_APP &&
            (privatePayload as { validateToken?: unknown }).validateToken === true;

        if (!privateOk) {
            return {
                ok: false,
                error:
                    'Libre Office utils token check failed. GET /api/shell-engine/about/private must return 200 with {"app":"libreoffice-docker-web-with-api","validateToken":true} when the token is valid.',
            };
        }
    } catch (error) {
        if (isAxiosError(error)) {
            console.error('Libre Office utils private about check:', error.message);
        } else {
            console.error(error);
        }
        return {
            ok: false,
            error:
                'Could not reach the Libre Office utils API for the token check. Ensure ai-notes-xyz-libreoffice is running.',
        };
    }

    return {
        ok: true,
        desktopOrigin,
        utilsOrigin,
        token,
        username,
        password,
    };
}
