import axios from 'axios';

import type { tsUserApiKey } from '../llm/llmCommonFunc';

export type LibreOfficeConfig = {
    desktopUrl: string;
    utilsUrl: string;
    token: string;
    basicAuthUsername: string;
    basicAuthPassword: string;
};

export const getLibreOfficeConfig = (apiKey: tsUserApiKey): LibreOfficeConfig | null => {
    if (
        !apiKey.libreOfficeValid ||
        !apiKey.libreOfficeUrl?.trim() ||
        !apiKey.libreOfficeUtilsUrl?.trim() ||
        !apiKey.libreOfficeUtilsToken
    ) {
        return null;
    }
    return {
        desktopUrl: apiKey.libreOfficeUrl.replace(/\/+$/, ''),
        utilsUrl: apiKey.libreOfficeUtilsUrl.replace(/\/+$/, ''),
        token: apiKey.libreOfficeUtilsToken,
        basicAuthUsername: apiKey.libreOfficeBasicAuthUsername || '',
        basicAuthPassword: apiKey.libreOfficeBasicAuthPassword || '',
    };
};

/** `https://user:pass@host/` for opening the Selkies desktop in a new tab. */
export const libreOfficeDesktopAuthUrl = (params: {
    desktopUrl: string;
    username: string;
    password: string;
}): string => {
    const raw = (params.desktopUrl || '').trim();
    const withSlash = raw.endsWith('/') ? raw : `${raw}/`;
    try {
        const u = new URL(withSlash);
        if (params.username) {
            u.username = params.username;
            u.password = params.password || '';
        }
        return u.toString();
    } catch {
        return withSlash;
    }
};

/** Filesystem-safe `username-_id` segment used by ai-notes-xyz-libreoffice. */
export const libreOfficeUsernameId = (username: string, userId: string): string => {
    const safeUser = String(username || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 64) || 'user';
    const safeId = String(userId || 'unknown').replace(/[^a-fA-F0-9]/g, '').slice(0, 64) || 'unknown';
    return `${safeUser}-${safeId}`;
};

/**
 * Same explorer/upload relative path, under the Libre Office user workspace:
 * `ai-notes-xyz/{username-_id}/{relativePath}`
 */
export const libreOfficeDestRelativePath = (params: {
    username: string;
    userId: string;
    relativePath: string;
}): string => {
    const rel = params.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    return `ai-notes-xyz/${libreOfficeUsernameId(params.username, params.userId)}/${rel}`.replace(/\/{2,}/g, '/');
};

const messageFromBody = (data: unknown, status: number): string => {
    if (typeof data === 'string' && data.trim()) {
        return data.trim().slice(0, 300);
    }
    if (data && typeof data === 'object' && 'message' in data) {
        const msg = String((data as { message?: unknown }).message || '');
        const extra =
            'error' in data && typeof (data as { error?: unknown }).error === 'string'
                ? String((data as { error: string }).error)
                : '';
        if (msg && extra) return `${msg}: ${extra}`;
        if (msg) return msg;
    }
    return `HTTP ${status}`;
};

export async function uploadBufferToLibreOffice(params: {
    utilsUrl: string;
    token: string;
    relativePath: string;
    buffer: Buffer;
    fileName: string;
    mimeType?: string;
    timeoutMs?: number;
}): Promise<{ ok: true; relativePath: string } | { ok: false; error: string; status?: number }> {
    const url = `${params.utilsUrl.replace(/\/+$/, '')}/api/shell-engine/file/write`;
    console.log('[libreoffice upload] POST', url, 'relativePath', params.relativePath, 'fileName', params.fileName, 'bytes', params.buffer.length);
    const form = new FormData();
    form.append('relativePath', params.relativePath);
    const bytes = new Uint8Array(params.buffer.buffer, params.buffer.byteOffset, params.buffer.byteLength);
    form.append(
        'file',
        new Blob([bytes], { type: params.mimeType || 'application/octet-stream' }),
        params.fileName,
    );

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'X-API-Token': params.token,
            },
            body: form,
            signal: AbortSignal.timeout(params.timeoutMs ?? 60_000),
        });
        const text = await res.text();
        console.log('[libreoffice upload] status', res.status, 'body', text);
        let data: unknown = text;
        try {
            data = JSON.parse(text);
        } catch {
            /* keep raw text */
        }
        if (res.status === 201 && data && typeof data === 'object') {
            const rel = (data as { relativePath?: unknown }).relativePath;
            if (typeof rel === 'string' && rel) {
                return { ok: true, relativePath: rel };
            }
        }
        return {
            ok: false,
            error: `Upload to Libre Office failed: ${messageFromBody(data, res.status)}`,
            status: res.status,
        };
    } catch (e) {
        console.log('[libreoffice upload] catch', e);
        return {
            ok: false,
            error: `Could not reach Libre Office utils write API: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
}

export async function openFileInLibreOffice(params: {
    utilsUrl: string;
    token: string;
    relativePath: string;
    timeoutMs?: number;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
    const url = `${params.utilsUrl.replace(/\/+$/, '')}/api/shell-engine/libreoffice/open`;
    console.log('[libreoffice openFile] POST', url, 'relativePath', params.relativePath);
    try {
        const res = await axios.post(
            url,
            { relativePath: params.relativePath },
            {
                timeout: params.timeoutMs ?? 30_000,
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Token': params.token,
                },
                validateStatus: () => true,
            },
        );
        console.log('[libreoffice openFile] status', res.status, 'body', res.data);
        if (res.status === 200) {
            return { ok: true };
        }
        return {
            ok: false,
            error: `Libre Office open failed: ${messageFromBody(res.data, res.status)}`,
            status: res.status,
        };
    } catch (e) {
        console.log('[libreoffice openFile] catch', e);
        return {
            ok: false,
            error: `Could not reach Libre Office open API: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
}
