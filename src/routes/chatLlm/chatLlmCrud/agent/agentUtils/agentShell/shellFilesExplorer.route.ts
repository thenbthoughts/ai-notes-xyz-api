import { Router, Request, Response } from 'express';
import path from 'path';
import axios from 'axios';
import mime from 'mime';
import fileUpload from 'express-fileupload';

import middlewareUserAuth from '../../../../../../middleware/middlewareUserAuth';
import { ModelUserApiKey } from '../../../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../../../utils/llm/llmCommonFunc';
import { AGENT_WORKSPACE_ROOT } from '../../../../../../utils/agentWorkspace/agentWorkspacePaths';
import { getAgentShellConfig, shellDeleteRelativePath, type AgentShellConfig } from './agentShellWorkspace';
import {
    readBufferFromShellEngine,
    unzipOnShellEngine,
    uploadBufferToShellEngine,
    zipDirFromShellEngine,
} from '../../../shellExecute/shellFileUpload';

const router = Router();

const DEFAULT_ROOT_DIR = AGENT_WORKSPACE_ROOT;
const ZIP_MAX_FILES = 400;
const ZIP_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const ZIP_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

const sanitizeRelativePath = (rawDir: string): string => {
    let clean = (rawDir || '').replace(/\\/g, '/').trim();
    if (!clean || clean === '.' || clean === '/') {
        return DEFAULT_ROOT_DIR;
    }
    // Strip leading slashes
    clean = clean.replace(/^\/+/, '');
    if (clean.includes('..')) {
        throw new Error('Invalid path: path cannot contain ..');
    }
    if (!clean.startsWith(DEFAULT_ROOT_DIR)) {
        clean = `${DEFAULT_ROOT_DIR}/${clean}`;
    }
    return clean;
};

const resolveUserShell = async (
    userId: unknown,
): Promise<{ ok: true; shell: AgentShellConfig } | { ok: false; status: number; message: string }> => {
    const apiKeyDoc = await ModelUserApiKey.findOne({ userId });
    if (!apiKeyDoc) {
        return { ok: false, status: 400, message: 'User API keys not found' };
    }
    const shell = getAgentShellConfig(getApiKeyByObject(apiKeyDoc));
    if (!shell) {
        return { ok: false, status: 400, message: 'Agent Workspace is not configured in settings.' };
    }
    return { ok: true, shell };
};

const safeUploadRelPath = (raw: string): string | null => {
    const normalized = (raw || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!normalized || normalized === '.' || normalized.includes('..')) return null;
    if (path.isAbsolute(normalized)) return null;
    return normalized;
};

const isZipUpload = (name: string, mimeType?: string): boolean => {
    const lower = (name || '').toLowerCase();
    return (
        lower.endsWith('.zip') ||
        mimeType === 'application/zip' ||
        mimeType === 'application/x-zip-compressed'
    );
};

const asUploadedFiles = (raw: fileUpload.UploadedFile | fileUpload.UploadedFile[] | undefined): fileUpload.UploadedFile[] => {
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
};

const asStringList = (raw: unknown): string[] => {
    if (typeof raw === 'string') return [raw];
    if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
    return [];
};

const writeShellEntries = async (params: {
    shell: AgentShellConfig;
    entries: { destPath: string; buffer: Buffer }[];
}): Promise<{ ok: true; uploaded: number } | { ok: false; uploaded: number; error: string }> => {
    let uploaded = 0;
    for (const item of params.entries) {
        const writeResult = await uploadBufferToShellEngine({
            baseUrl: params.shell.baseUrl,
            token: params.shell.token,
            relativePath: item.destPath,
            buffer: item.buffer,
            fileName: path.posix.basename(item.destPath),
            mimeType: mime.getType(item.destPath) || 'application/octet-stream',
            timeoutMs: 60_000,
        });
        if (!writeResult.ok) {
            return { ok: false, uploaded, error: `Failed to write ${item.destPath}: ${writeResult.error}` };
        }
        uploaded += 1;
    }
    return { ok: true, uploaded };
};

/**
 * GET /api/chat-llm/shell-files/list
 * List files and directories inside root ai-notes-xyz-agent-workspace
 */
router.get('/list', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const requestedDir = typeof req.query.relativeDir === 'string' ? req.query.relativeDir : DEFAULT_ROOT_DIR;
        const relativeDir = sanitizeRelativePath(requestedDir);

        const apiKeyDoc = await ModelUserApiKey.findOne({ userId });
        if (!apiKeyDoc) {
            return res.status(400).json({ message: 'User API keys not found' });
        }
        const apiKey = getApiKeyByObject(apiKeyDoc);
        const shell = getAgentShellConfig(apiKey);

        if (!shell) {
            return res.status(400).json({ message: 'Agent Workspace is not configured in settings.' });
        }

        const normalizedDir = relativeDir.replace(/\/+$/, '');
        const shellBase = shell.baseUrl.replace(/\/+$/, '');
        const lsRes = await axios.get(`${shellBase}/api/shell-engine/file/ls`, {
            params: { relativeDir: normalizedDir },
            timeout: 60_000,
            headers: { 'X-API-Token': shell.token },
            validateStatus: () => true,
        });

        if (lsRes.status === 200) {
            const body = (lsRes.data && typeof lsRes.data === 'object' ? lsRes.data : {}) as { entries?: unknown };
            const rawEntries = Array.isArray(body.entries) ? body.entries : [];
            const files = rawEntries
                .map((row) => {
                    if (!row || typeof row !== 'object') return null;
                    const o = row as Record<string, unknown>;
                    const relPath = typeof o.relativePath === 'string' ? o.relativePath.replace(/\\/g, '/') : '';
                    if (!relPath) return null;
                    const name = typeof o.name === 'string' && o.name ? o.name : path.basename(relPath);
                    const isDir = Boolean(o.isDir);
                    const ext = isDir ? '' : path.extname(name).toLowerCase();
                    const fileCount = typeof o.fileCount === 'number' ? o.fileCount : 0;
                    const folderCount = typeof o.folderCount === 'number' ? o.folderCount : 0;
                    return {
                        name,
                        relativePath: relPath,
                        isDir,
                        size: typeof o.size === 'number' ? o.size : 0,
                        mtimeMs: typeof o.mtimeMs === 'number' ? o.mtimeMs : 0,
                        extension: ext,
                        mimeType: isDir ? 'directory' : mime.getType(ext) || 'application/octet-stream',
                        itemCount: isDir ? fileCount + folderCount : undefined,
                        fileCount: isDir ? fileCount : undefined,
                        folderCount: isDir ? folderCount : undefined,
                        truncated: isDir ? Boolean(o.truncated) : undefined,
                    };
                })
                .filter((item): item is NonNullable<typeof item> => item !== null);

            return res.json({
                success: true,
                relativeDir: normalizedDir,
                rootDir: DEFAULT_ROOT_DIR,
                files,
            });
        }

        const errMsg =
            lsRes.data && typeof lsRes.data === 'object' && 'message' in lsRes.data
                ? String(lsRes.data.message)
                : `Agent Workspace HTTP ${lsRes.status}`;
        return res.status(lsRes.status).json({ message: errMsg });
    } catch (error) {
        console.error('shell-files list error:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to list shell files',
        });
    }
});

/**
 * GET /api/chat-llm/shell-files/download
 * Download a file from ai-notes-xyz-agent-workspace
 */
router.get('/download', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const rawPath = typeof req.query.relativePath === 'string' ? req.query.relativePath : '';
        if (!rawPath) {
            return res.status(400).json({ message: 'relativePath parameter is required' });
        }

        const relativePath = sanitizeRelativePath(rawPath);
        const apiKeyDoc = await ModelUserApiKey.findOne({ userId });
        if (!apiKeyDoc) {
            return res.status(400).json({ message: 'User API keys not found' });
        }
        const apiKey = getApiKeyByObject(apiKeyDoc);
        const shell = getAgentShellConfig(apiKey);

        if (!shell) {
            return res.status(400).json({ message: 'Agent Workspace is not configured in settings.' });
        }

        const readResult = await readBufferFromShellEngine({
            baseUrl: shell.baseUrl,
            token: shell.token,
            relativePath,
            timeoutMs: 60_000,
        });

        if (!readResult.ok) {
            return res.status(readResult.status || 500).json({ message: readResult.error });
        }

        const fileName = path.basename(relativePath) || 'download';
        const mimeType = mime.getType(fileName) || 'application/octet-stream';

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', readResult.buffer.length);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        return res.send(readResult.buffer);
    } catch (error) {
        console.error('shell-files download error:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to download file',
        });
    }
});
/**
 * POST /api/chat-llm/shell-files/delete
 * Delete a file or directory inside root ai-notes-xyz-agent-workspace
 */
router.post('/delete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const rawPath = typeof req.body.relativePath === 'string' ? req.body.relativePath : '';
        if (!rawPath) {
            return res.status(400).json({ message: 'relativePath parameter is required' });
        }

        const relativePath = sanitizeRelativePath(rawPath);
        const apiKeyDoc = await ModelUserApiKey.findOne({ userId });
        if (!apiKeyDoc) {
            return res.status(400).json({ message: 'User API keys not found' });
        }
        const apiKey = getApiKeyByObject(apiKeyDoc);
        const shell = getAgentShellConfig(apiKey);

        if (!shell) {
            return res.status(400).json({ message: 'Agent Workspace is not configured in settings.' });
        }

        const result = await shellDeleteRelativePath({ shell, relativePath });
        if (!result.ok) {
            return res.status(400).json({ message: result.error || 'Failed to delete file/folder' });
        }

        return res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        console.error('shell-files delete error:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to delete file',
        });
    }
});

/**
 * GET /api/chat-llm/shell-files/download-zip
 * Download a folder as a zip (files packed relative to that folder).
 */
router.get('/download-zip', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const rawDir = typeof req.query.relativeDir === 'string' ? req.query.relativeDir : '';
        if (!rawDir) {
            return res.status(400).json({ message: 'relativeDir parameter is required' });
        }

        const relativeDir = sanitizeRelativePath(rawDir).replace(/\/+$/, '');
        const resolved = await resolveUserShell(userId);
        if (!resolved.ok) {
            return res.status(resolved.status).json({ message: resolved.message });
        }

        const zipped = await zipDirFromShellEngine({
            baseUrl: resolved.shell.baseUrl,
            token: resolved.shell.token,
            relativeDir,
            timeoutMs: 120_000,
        });
        if (!zipped.ok) {
            return res.status(zipped.status || 500).json({ message: zipped.error });
        }
        const zipName = `${path.basename(relativeDir) || 'folder'}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Length', zipped.buffer.length);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);
        return res.send(zipped.buffer);
    } catch (error) {
        console.error('shell-files download-zip error:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to download folder zip',
        });
    }
});

const handleShellFilesUpload = async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const rawDir = typeof req.body?.relativeDir === 'string' ? req.body.relativeDir : '';
        if (!rawDir) {
            return res.status(400).json({ message: 'relativeDir is required' });
        }
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const uploadedFiles = asUploadedFiles(req.files.file as fileUpload.UploadedFile | fileUpload.UploadedFile[]);
        if (uploadedFiles.length === 0) {
            return res.status(400).json({ message: 'Upload files using the "file" field' });
        }

        const relativeDir = sanitizeRelativePath(rawDir).replace(/\/+$/, '');
        const resolved = await resolveUserShell(userId);
        if (!resolved.ok) {
            return res.status(resolved.status).json({ message: resolved.message });
        }

        const relativePaths = asStringList(req.body?.relativePath);
        const entries: { destPath: string; buffer: Buffer }[] = [];
        let extractedZipCount = 0;
        let extractedFileCount = 0;

        for (let i = 0; i < uploadedFiles.length; i += 1) {
            const uploaded = uploadedFiles[i];
            const rawRel =
                relativePaths[i] ||
                uploaded.name ||
                `file-${i + 1}`;
            const safeRel = safeUploadRelPath(rawRel) || path.posix.basename(uploaded.name || `file-${i + 1}`);
            const destBase = `${relativeDir}/${safeRel}`.replace(/\/{2,}/g, '/');
            if (destBase.includes('..')) continue;

            if (isZipUpload(uploaded.name || safeRel, uploaded.mimetype)) {
                const zipDir = path.posix.dirname(destBase);
                const zipPrefix = !zipDir || zipDir === '.' ? relativeDir : zipDir;
                const unzipped = await unzipOnShellEngine({
                    baseUrl: resolved.shell.baseUrl,
                    token: resolved.shell.token,
                    destRelativeDir: zipPrefix,
                    buffer: uploaded.data,
                    fileName: path.posix.basename(safeRel) || 'upload.zip',
                    timeoutMs: 120_000,
                });
                if (!unzipped.ok) {
                    return res.status(unzipped.status || 400).json({
                        message: unzipped.error,
                        uploaded: extractedFileCount,
                    });
                }
                extractedZipCount += 1;
                extractedFileCount += unzipped.extracted;
            } else {
                entries.push({ destPath: destBase, buffer: uploaded.data });
            }
        }

        if (entries.length === 0 && extractedZipCount === 0) {
            return res.status(400).json({ message: 'Nothing to upload' });
        }
        if (entries.length > ZIP_MAX_FILES) {
            return res.status(400).json({
                message: `Too many files to upload (max ${ZIP_MAX_FILES})`,
            });
        }
        const totalBytes = entries.reduce((sum, e) => sum + e.buffer.length, 0);
        if (totalBytes > ZIP_MAX_TOTAL_BYTES) {
            return res.status(400).json({ message: 'Upload is too large (max 40 MB)' });
        }

        let written = 0;
        if (entries.length > 0) {
            const writeResult = await writeShellEntries({ shell: resolved.shell, entries });
            if (!writeResult.ok) {
                return res.status(400).json({
                    message: writeResult.error,
                    uploaded: writeResult.uploaded + extractedFileCount,
                });
            }
            written = writeResult.uploaded;
        }

        const uploaded = written + extractedFileCount;
        const zipNote = extractedZipCount > 0 ? ` (extracted ${extractedZipCount} zip)` : '';
        return res.json({
            success: true,
            message: `Uploaded ${uploaded} file(s) into ${relativeDir}${zipNote}`,
            uploaded,
            extractedZips: extractedZipCount,
            relativeDir,
        });
    } catch (error) {
        console.error('shell-files upload error:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to upload files',
        });
    }
};

const uploadMiddleware = fileUpload({
    limits: { fileSize: ZIP_UPLOAD_MAX_BYTES },
    abortOnLimit: true,
});

/**
 * POST /api/chat-llm/shell-files/upload
 * Upload files or a folder into relativeDir. Zip files are extracted.
 */
router.post('/upload', middlewareUserAuth, uploadMiddleware, handleShellFilesUpload);

/**
 * POST /api/chat-llm/shell-files/upload-zip
 * Same as /upload (kept for existing clients).
 */
router.post('/upload-zip', middlewareUserAuth, uploadMiddleware, handleShellFilesUpload);

export default router;
