/**
 * Drive folder/file path validation (S3 key–safe, no path traversal).
 */

const MAX_SEGMENT_LENGTH = 200;
const MAX_PATH_LENGTH = 900;
/** Allowed segment chars: letters, digits, spaces, common punctuation safe for S3 keys */
const SEGMENT_PATTERN = /^[\w.\-()+@[\] ]+$/;

export type PathValidationResult =
    | { valid: true; normalized: string; segments: string[] }
    | { valid: false; error: string };

const normalizeSlashes = (value: string): string =>
    value.replace(/\\/g, '/').replace(/\/+/g, '/').trim();

/**
 * Validate a folder path relative to the bucket prefix.
 * Empty string = root. Segments like `docs/notes` are allowed.
 */
export const validateDriveFolderPath = (rawPath: unknown): PathValidationResult => {
    if (rawPath === undefined || rawPath === null) {
        return { valid: true, normalized: '', segments: [] };
    }

    if (typeof rawPath !== 'string') {
        return { valid: false, error: 'Folder path must be a string' };
    }

    const trimmed = normalizeSlashes(rawPath);
    if (!trimmed || trimmed === '/') {
        return { valid: true, normalized: '', segments: [] };
    }

    if (trimmed.startsWith('/')) {
        return { valid: false, error: 'Folder path must be relative (no leading slash)' };
    }

    if (trimmed.includes('\0') || /[\x00-\x1f\x7f]/.test(trimmed)) {
        return { valid: false, error: 'Folder path contains invalid control characters' };
    }

    const withoutTrailing = trimmed.replace(/\/+$/, '');
    if (withoutTrailing.length > MAX_PATH_LENGTH) {
        return { valid: false, error: `Folder path must be at most ${MAX_PATH_LENGTH} characters` };
    }

    const segments = withoutTrailing.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) {
        return { valid: true, normalized: '', segments: [] };
    }

    for (const segment of segments) {
        const segmentResult = validateDrivePathSegment(segment, 'folder');
        if (!segmentResult.valid) {
            return segmentResult;
        }
    }

    return {
        valid: true,
        normalized: segments.join('/'),
        segments,
    };
};

/**
 * Validate a single path segment (folder or file basename).
 */
export const validateDrivePathSegment = (
    rawName: unknown,
    kind: 'folder' | 'file' = 'file'
): PathValidationResult => {
    if (typeof rawName !== 'string') {
        return { valid: false, error: `${kind === 'folder' ? 'Folder' : 'File'} name must be a string` };
    }

    const name = rawName.trim();
    if (!name) {
        return { valid: false, error: `${kind === 'folder' ? 'Folder' : 'File'} name is required` };
    }

    if (name.includes('/') || name.includes('\\')) {
        return {
            valid: false,
            error: `${kind === 'folder' ? 'Folder' : 'File'} name cannot contain slashes`,
        };
    }

    if (name === '.' || name === '..') {
        return { valid: false, error: `Invalid ${kind} name` };
    }

    if (name.includes('\0') || /[\x00-\x1f\x7f]/.test(name)) {
        return { valid: false, error: `${kind === 'folder' ? 'Folder' : 'File'} name contains invalid characters` };
    }

    if (name.length > MAX_SEGMENT_LENGTH) {
        return {
            valid: false,
            error: `${kind === 'folder' ? 'Folder' : 'File'} name must be at most ${MAX_SEGMENT_LENGTH} characters`,
        };
    }

    if (!SEGMENT_PATTERN.test(name)) {
        return {
            valid: false,
            error: `${kind === 'folder' ? 'Folder' : 'File'} name may only contain letters, numbers, spaces, and ._-()+@[]`,
        };
    }

    return { valid: true, normalized: name, segments: [name] };
};

/**
 * Ensure create-file names end with .txt or .md / .markdown
 */
export const validateDriveCreateFileName = (
    rawName: unknown,
    fileType: 'txt' | 'md'
): PathValidationResult => {
    const base = validateDrivePathSegment(rawName, 'file');
    if (!base.valid) {
        return base;
    }

    const lower = base.normalized.toLowerCase();
    if (fileType === 'txt') {
        if (!lower.endsWith('.txt')) {
            return {
                valid: true,
                normalized: `${base.normalized}.txt`,
                segments: [`${base.normalized}.txt`],
            };
        }
    } else {
        if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) {
            return {
                valid: true,
                normalized: `${base.normalized}.md`,
                segments: [`${base.normalized}.md`],
            };
        }
    }

    return base;
};
