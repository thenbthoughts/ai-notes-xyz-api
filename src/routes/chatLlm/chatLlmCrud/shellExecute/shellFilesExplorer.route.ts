import { Router, Request, Response } from 'express';
import path from 'path';
import axios from 'axios';
import mime from 'mime';

import middlewareUserAuth from '../../../../middleware/middlewareUserAuth';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import { getAgentShellConfig } from '../agent/agentShellWorkspace';
import { readBufferFromShellEngine } from '../shellExecute/shellFileUpload';

const router = Router();

const DEFAULT_ROOT_DIR = 'ai-notes-xyz-shell-files';

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
    if (!clean.startsWith(DEFAULT_ROOT_DIR) && !clean.startsWith('ai-notes-xyz')) {
        clean = `${DEFAULT_ROOT_DIR}/${clean}`;
    }
    return clean;
};

/**
 * GET /api/chat-llm/shell-files/list
 * List files and directories inside root ai-notes-xyz-shell-files
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
            return res.status(400).json({ message: 'Shell Engine is not configured in settings.' });
        }

        const shellRes = await axios.get(`${shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/list`, {
            params: { relativeDir, maxFiles: 1000 },
            timeout: 30_000,
            headers: { 'X-API-Token': shell.token },
            validateStatus: () => true,
        });

        if (shellRes.status !== 200) {
            const errMsg =
                shellRes.data && typeof shellRes.data === 'object' && 'message' in shellRes.data
                    ? String(shellRes.data.message)
                    : `Shell Engine HTTP ${shellRes.status}`;
            return res.status(shellRes.status).json({ message: errMsg });
        }

        const body = (shellRes.data && typeof shellRes.data === 'object' ? shellRes.data : {}) as { files?: unknown };
        const rawFiles = Array.isArray(body.files) ? body.files : [];

        const normalizedDir = relativeDir.replace(/\/+$/, '');

        // Build all flat file items
        const allItems = rawFiles
            .map((row) => {
                if (!row || typeof row !== 'object') return null;
                const o = row as Record<string, unknown>;
                const relPath = typeof o.relativePath === 'string' ? o.relativePath.replace(/\\/g, '/') : '';
                if (!relPath) return null;

                const name = path.basename(relPath);
                const isDir = Boolean(o.isDir);
                const size = typeof o.size === 'number' ? o.size : 0;
                const mtimeMs = typeof o.mtimeMs === 'number' ? o.mtimeMs : 0;
                const ext = path.extname(name).toLowerCase();
                const mimeType = isDir ? 'directory' : mime.getType(ext) || 'application/octet-stream';

                return {
                    name,
                    relativePath: relPath,
                    isDir,
                    size,
                    mtimeMs,
                    extension: ext,
                    mimeType,
                };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

        // Group into direct children for folder structure view
        const dirMap = new Map<string, { name: string; relativePath: string; isDir: true; size: number; mtimeMs: number; itemCount: number }>();
        const directFiles: typeof allItems = [];

        for (const item of allItems) {
            if (item.relativePath === normalizedDir) continue;

            if (item.relativePath.startsWith(`${normalizedDir}/`)) {
                const rest = item.relativePath.substring(normalizedDir.length + 1);
                const parts = rest.split('/');

                if (parts.length > 1) {
                    // Subdirectory child
                    const folderName = parts[0];
                    const folderRelPath = `${normalizedDir}/${folderName}`;
                    const existing = dirMap.get(folderRelPath);
                    if (existing) {
                        existing.size += item.size;
                        existing.itemCount += 1;
                        existing.mtimeMs = Math.max(existing.mtimeMs, item.mtimeMs);
                    } else {
                        dirMap.set(folderRelPath, {
                            name: folderName,
                            relativePath: folderRelPath,
                            isDir: true,
                            size: item.size,
                            mtimeMs: item.mtimeMs,
                            itemCount: 1,
                        });
                    }
                } else {
                    // Direct file or direct subfolder
                    if (item.isDir) {
                        if (!dirMap.has(item.relativePath)) {
                            dirMap.set(item.relativePath, {
                                name: item.name,
                                relativePath: item.relativePath,
                                isDir: true,
                                size: item.size,
                                mtimeMs: item.mtimeMs,
                                itemCount: 0,
                            });
                        }
                    } else {
                        directFiles.push(item);
                    }
                }
            }
        }

        const directFolders = Array.from(dirMap.values()).map((f) => ({
            name: f.name,
            relativePath: f.relativePath,
            isDir: true as const,
            size: f.size,
            mtimeMs: f.mtimeMs,
            extension: '',
            mimeType: 'directory',
            itemCount: f.itemCount,
        }));

        // Folders first, then files
        const folderStructuredItems = [...directFolders, ...directFiles];

        return res.json({
            success: true,
            relativeDir: normalizedDir,
            rootDir: DEFAULT_ROOT_DIR,
            files: folderStructuredItems,
            allItems,
        });
    } catch (error) {
        console.error('shell-files list error:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to list shell files',
        });
    }
});

/**
 * GET /api/chat-llm/shell-files/download
 * Download a file from ai-notes-xyz-shell-files
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
            return res.status(400).json({ message: 'Shell Engine is not configured in settings.' });
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
 * Delete a file or directory inside root ai-notes-xyz-shell-files
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
            return res.status(400).json({ message: 'Shell Engine is not configured in settings.' });
        }

        // 1. Try Shell Engine file delete API
        const shellRes = await axios.post(
            `${shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/delete`,
            { relativePath },
            {
                timeout: 30_000,
                headers: { 'X-API-Token': shell.token, 'Content-Type': 'application/json' },
                validateStatus: () => true,
            }
        );

        if (shellRes.status === 200) {
            return res.json({ success: true, message: 'Deleted successfully' });
        }

        // 2. Fallback: run shell command rm -rf
        const execRes = await axios.post(
            `${shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/execute`,
            { command: `rm -rf "${relativePath}" 2>&1` },
            {
                timeout: 30_000,
                headers: { 'X-API-Token': shell.token, 'Content-Type': 'application/json' },
                validateStatus: () => true,
            }
        );

        if (execRes.status === 200) {
            return res.json({ success: true, message: 'Deleted successfully' });
        }

        return res.status(400).json({ message: 'Failed to delete file/folder' });
    } catch (error) {
        console.error('shell-files delete error:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to delete file',
        });
    }
});

export default router;
