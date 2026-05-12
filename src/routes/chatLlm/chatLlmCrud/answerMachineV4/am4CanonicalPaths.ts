import { sanitizePathSegment } from './am4ShellFileUpload';

const AM4_SHELL_ROOT_PREFIX = 'ai-notes-xyz-shell-files';
const OUTPUT_FILENAME_PATTERN = /\b[\w.-]+\.(png|jpe?g|gif|webp|pdf|txt|csv|json|md|zip)\b/gi;
const MAX_OUTPUT_SYNC_FILES = 12;

export { AM4_SHELL_ROOT_PREFIX, MAX_OUTPUT_SYNC_FILES };

/** Validates relative paths passed to the Shell Engine (no traversal). */
export function assertSafeAm4ShellRelativePath(relativePath: string): void {
    const trimmed = (relativePath || '').trim();
    if (!trimmed) {
        throw new Error('AM4 shell relative path is empty');
    }
    if (trimmed.includes('..')) {
        throw new Error('AM4 shell relative path must not contain ".."');
    }
    if (!trimmed.startsWith(`${AM4_SHELL_ROOT_PREFIX}/`)) {
        throw new Error(`AM4 shell relative path must start with "${AM4_SHELL_ROOT_PREFIX}/"`);
    }
}

/**
 * Canonical workspace layout inside the OpenCode / shell container (relative to Shell Engine root).
 */
export function buildAm4CanonicalShellPaths(params: {
    userObjectId: string;
    threadId: string;
}): {
    inputFileRelativePath: (descriptiveFileName: string) => string;
    outputFileRelativePath: (descriptiveFileName: string) => string;
    workDirectoryMarkerRelativePath: string;
} {
    const safeUserId = sanitizePathSegment(params.userObjectId);
    const safeThreadId = sanitizePathSegment(params.threadId);
    const base = `${AM4_SHELL_ROOT_PREFIX}/${safeUserId}/chat/${safeThreadId}`;
    return {
        inputFileRelativePath: (descriptiveFileName: string) =>
            `${base}/${sanitizePathSegment(descriptiveFileName)}`,
        outputFileRelativePath: (descriptiveFileName: string) =>
            `${base}/outputfile/${sanitizePathSegment(descriptiveFileName)}`,
        workDirectoryMarkerRelativePath: `${base}/workdirectory/.am4-workspace-marker`,
    };
}

export function extractAm4OutputCandidateFilenames(assistantAnswerText: string): string[] {
    const text = assistantAnswerText || '';
    const found = new Set<string>();
    let match: RegExpExecArray | null;
    const pattern = new RegExp(OUTPUT_FILENAME_PATTERN);
    while ((match = pattern.exec(text)) !== null) {
        found.add(match[0]);
        if (found.size >= MAX_OUTPUT_SYNC_FILES) {
            break;
        }
    }
    return [...found];
}
