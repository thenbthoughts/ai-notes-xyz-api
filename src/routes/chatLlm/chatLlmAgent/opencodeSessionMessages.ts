import type { OpencodeSdkClient } from './utils/opencodeSdkHelpers';

const TRANSCRIPT_MAX_CHARS = 100_000;

export async function fetchOpencodeSessionMessageEntries(
    client: OpencodeSdkClient,
    workspaceDirectory: string,
    sdkSessionId: string
): Promise<Array<{ info: unknown; parts: unknown[] }>> {
    try {
        const res = await client.session.messages({
            path: { id: sdkSessionId },
            query: { directory: workspaceDirectory, limit: 500 },
        } as any);
        const wrap = res as { data?: unknown; error?: unknown };
        if (wrap?.error) {
            return [];
        }
        const d = wrap?.data;
        if (!Array.isArray(d)) {
            return [];
        }
        return d.filter((x) => x && typeof x === 'object') as Array<{ info: unknown; parts: unknown[] }>;
    } catch {
        return [];
    }
}

export function hasOpencodeAssistantOrToolActivity(
    entries: Array<{ info: unknown; parts: unknown[] }>
): boolean {
    for (const entry of entries) {
        const info =
            entry && typeof entry.info === 'object' && entry.info
                ? (entry.info as Record<string, unknown>)
                : null;
        const role = info?.role;
        if (role === 'assistant') {
            return true;
        }
        const parts = Array.isArray(entry.parts) ? entry.parts : [];
        for (const p of parts) {
            if (!p || typeof p !== 'object') continue;
            const pt = p as Record<string, unknown>;
            const type = pt.type;
            if (type === 'tool' || type === 'reasoning' || type === 'step-start' || type === 'step-finish') {
                return true;
            }
        }
    }
    return false;
}

export function hasOpencodeCompletedAssistantReply(
    entries: Array<{ info: unknown; parts: unknown[] }>
): boolean {
    for (const entry of entries) {
        const info =
            entry && typeof entry.info === 'object' && entry.info
                ? (entry.info as Record<string, unknown>)
                : null;
        const role = info?.role;
        if (role === 'assistant') {
            const time = info?.time;
            if (time && typeof time === 'object' && (time as Record<string, unknown>).completed != null) {
                return true;
            }
            if (info?.error != null) {
                return true;
            }
            if (typeof info?.finish === 'string' && info.finish.length >= 1) {
                return true;
            }
        }
        const parts = Array.isArray(entry.parts) ? entry.parts : [];
        for (const p of parts) {
            if (!p || typeof p !== 'object') continue;
            const pt = p as Record<string, unknown>;
            const type = pt.type;
            if (type === 'step-finish') {
                return true;
            }
            if (type === 'tool') {
                const state = pt.state;
                if (state && typeof state === 'object') {
                    const st = (state as Record<string, unknown>).status;
                    if (st === 'completed' || st === 'error') {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

function formatToolPart(pt: Record<string, unknown>): string {
    const tool = typeof pt.tool === 'string' ? pt.tool : 'tool';
    const state = pt.state;
    if (!state || typeof state !== 'object') {
        return `[${tool}]`;
    }
    const st = (state as Record<string, unknown>).status;
    if (st === 'completed') {
        const title = typeof (state as Record<string, unknown>).title === 'string' ? (state as any).title : '';
        const output =
            typeof (state as Record<string, unknown>).output === 'string' ? (state as any).output : '';
        const head = title ? `[${tool}] ${title}` : `[${tool}]`;
        return output ? `${head}\n${output}` : head;
    }
    if (st === 'error') {
        const err = (state as Record<string, unknown>).error;
        return `[${tool}] error: ${typeof err === 'string' ? err : JSON.stringify(err)}`;
    }
    if (st === 'running' || st === 'pending') {
        const title = typeof (state as Record<string, unknown>).title === 'string' ? (state as any).title : '';
        return `[${tool}] (${String(st)})${title ? ` ${title}` : ''}`;
    }
    return `[${tool}] (${String(st)})`;
}

function formatOneEntry(entry: { info: unknown; parts: unknown[] }): string {
    const info = entry.info && typeof entry.info === 'object' ? (entry.info as Record<string, unknown>) : null;
    const roleRaw = info?.role;
    const roleLabel =
        roleRaw === 'user' ? 'User' : roleRaw === 'assistant' ? 'Assistant' : String(roleRaw || 'message');
    const lines: string[] = [`### ${roleLabel}`];

    const parts = Array.isArray(entry.parts) ? entry.parts : [];
    for (const p of parts) {
        if (!p || typeof p !== 'object') continue;
        const pt = p as Record<string, unknown>;
        const type = pt.type;
        if (type === 'text' && typeof pt.text === 'string' && pt.text.length >= 1) {
            lines.push(pt.text);
        } else if (type === 'reasoning' && typeof pt.text === 'string' && pt.text.length >= 1) {
            lines.push(`(reasoning)\n${pt.text}`);
        } else if (type === 'tool') {
            lines.push(formatToolPart(pt));
        }
    }

    if (lines.length === 1) {
        return '';
    }
    return lines.join('\n');
}

export function formatOpencodeMessageDeltaToTranscript(
    entries: Array<{ info: unknown; parts: unknown[] }>
): string {
    const chunks = entries.map(formatOneEntry).filter((s) => s.length >= 1);
    let out = chunks.join('\n\n---\n\n');
    if (out.length > TRANSCRIPT_MAX_CHARS) {
        out = `${out.slice(0, TRANSCRIPT_MAX_CHARS)}\n\n… (truncated)`;
    }
    return out;
}
