import mongoose from 'mongoose';

/** Subdirectories under each thread workspace root on the OpenCode host. */
export const OPENCODE_THREAD_SUBDIR_INPUTFILES = 'inputfiles';
export const OPENCODE_THREAD_SUBDIR_OUTPUTFILES = 'outputfiles';
export const OPENCODE_THREAD_SUBDIR_CODEEXECUTION = 'codeexecution';

/**
 * Safe single path segment for Linux (OpenCode container). Avoids `/` and control chars.
 */
export function sanitizeLinuxPathSegment(segment: string): string {
    const s = (segment || '').trim();
    if (!s) {
        return '_';
    }
    const cleaned = s.replace(/[^\w.@+-]+/g, '_').replace(/^\.+/, '').slice(0, 200);
    return cleaned.length >= 1 ? cleaned : '_';
}

export function bashSingleQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * OpenCode session workspace root:
 * `/home/ainotesxyz/users/{userId}/thread/{threadId}`
 *
 * Expected layout under this root:
 * - inputfiles
 * - outputfiles
 * - codeexecution
 *
 * `userId` is the app user's MongoDB ObjectId string (not the login name).
 */
export function buildThreadScopedOpencodeWorkspaceRoot(
    userId: mongoose.Types.ObjectId | string,
    threadId: mongoose.Types.ObjectId | string
): string {
    const uid = typeof userId === 'string' ? userId.trim() : userId.toString();
    const tid = typeof threadId === 'string' ? threadId : threadId.toString();
    return `/home/ainotesxyz/users/${uid}/thread/${tid}`;
}
