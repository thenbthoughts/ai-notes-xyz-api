import axios from 'axios';

export async function uploadBufferToShellEngine(params: {
    baseUrl: string;
    token: string;
    relativePath: string;
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    timeoutMs?: number;
}): Promise<
    | { ok: true; absolutePath: string; relativePath: string; size: number }
    | { ok: false; error: string }
> {
    const url = `${params.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/write`;
    const form = new FormData();
    form.append('relativePath', params.relativePath);
    const blob = new Blob([params.buffer], { type: params.mimeType || 'application/octet-stream' });
    form.append('file', blob, params.fileName);

    try {
        const res = await axios.post(url, form, {
            headers: {
                'X-API-Token': params.token,
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: params.timeoutMs ?? 120_000,
            validateStatus: () => true,
        });

        if (res.status === 201 && res.data && typeof res.data === 'object') {
            const d = res.data as Record<string, unknown>;
            const abs = typeof d.absolutePath === 'string' ? d.absolutePath : '';
            const rel = typeof d.relativePath === 'string' ? d.relativePath : '';
            const size = typeof d.size === 'number' ? d.size : params.buffer.length;
            if (abs && rel) {
                return { ok: true, absolutePath: abs, relativePath: rel, size };
            }
        }

        const msg =
            res.data && typeof res.data === 'object' && 'message' in res.data
                ? String((res.data as { message: unknown }).message)
                : `HTTP ${res.status}`;
        return { ok: false, error: msg };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function readBufferFromShellEngine(params: {
    baseUrl: string;
    token: string;
    relativePath: string;
    timeoutMs?: number;
}): Promise<
    | { ok: true; buffer: Buffer; status: number }
    | { ok: false; error: string; status?: number }
> {
    const url = `${params.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/read`;
    try {
        const res = await axios.get(url, {
            params: { relativePath: params.relativePath },
            responseType: 'arraybuffer',
            timeout: params.timeoutMs ?? 120_000,
            headers: { 'X-API-Token': params.token },
            validateStatus: () => true,
        });
        if (res.status === 200 && res.data) {
            return { ok: true, buffer: Buffer.from(res.data as ArrayBuffer), status: res.status };
        }
        const msg =
            res.data && typeof res.data === 'object' && 'message' in (res.data as object)
                ? String((res.data as { message?: unknown }).message)
                : `HTTP ${res.status}`;
        return { ok: false, error: msg, status: res.status };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export function sanitizePathSegment(name: string): string {
    const base = name.replace(/[/\\]/g, '_').replace(/\.\./g, '_').trim();
    const cleaned = base.replace(/[^\w.\-()+@[\] ]+/g, '_').slice(0, 200);
    return cleaned || 'file';
}

/** Relative path segments must include `ai-notes-xyz-shell-files` per shell service rules. */
export function buildAm4ShellRelativePath(params: {
    userId: string;
    threadId: string;
    /** Real request id, or `"pending"` before the AM4 request document exists. */
    requestId: string;
    originalFileName: string;
}): string {
    const safeUser = sanitizePathSegment(params.userId);
    const safeThread = sanitizePathSegment(params.threadId);
    const safeReq = sanitizePathSegment(params.requestId);
    const safeFile = sanitizePathSegment(params.originalFileName);
    const stamp = Date.now();
    return `ai-notes-xyz-shell-files/am4-uploads/${safeUser}/${safeThread}/${safeReq}/${stamp}-${safeFile}`;
}
