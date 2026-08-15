import { Router, Request, Response } from 'express';
import path from 'path';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { ModelUser } from '../../../schema/schemaUser/SchemaUser.schema';
import { ModelUserApiKey } from '../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject, type tsUserApiKey } from '../../../utils/llm/llmCommonFunc';
import {
    getLibreOfficeConfig,
    libreOfficeDesktopAuthUrl,
    libreOfficeDestRelativePath,
    openFileInLibreOffice,
    uploadBufferToLibreOffice,
} from '../../../utils/libreOffice/libreOfficeConfig';
import { readBufferFromShellEngine } from '../chatLlmCrud/shellExecute/shellFileUpload';

const router = Router();

const DEFAULT_ROOT_DIR = 'ai-notes-xyz-shell-files';

const sanitizeRelativePath = (rawDir: string): string => {
    let clean = (rawDir || '').replace(/\\/g, '/').trim();
    if (!clean || clean === '.' || clean === '/') {
        throw new Error('relativePath is required');
    }
    clean = clean.replace(/^\/+/, '');
    if (clean.includes('..')) {
        throw new Error('Invalid path: path cannot contain ..');
    }
    if (!clean.startsWith(DEFAULT_ROOT_DIR) && !clean.startsWith('ai-notes-xyz')) {
        clean = `${DEFAULT_ROOT_DIR}/${clean}`;
    }
    return clean;
};

const getShellConfig = (apiKey: tsUserApiKey) => {
    if (apiKey.shellEngineValid && apiKey.shellEngineUrl?.trim() && apiKey.shellEngineToken) {
        return {
            baseUrl: apiKey.shellEngineUrl.replace(/\/+$/, ''),
            token: apiKey.shellEngineToken,
        };
    }
    if (apiKey.opencodeWithCustomShellUrl?.trim() && apiKey.opencodeWithCustomShellToken) {
        return {
            baseUrl: apiKey.opencodeWithCustomShellUrl.replace(/\/+$/, ''),
            token: apiKey.opencodeWithCustomShellToken,
        };
    }
    return null;
};

const resolveLibreOffice = async (userId: unknown) => {
    const apiKeyDoc = await ModelUserApiKey.findOne({ userId });
    if (!apiKeyDoc) {
        return { ok: false as const, status: 400, message: 'User API keys not found' };
    }
    const apiKey = getApiKeyByObject(apiKeyDoc);
    const libre = getLibreOfficeConfig(apiKey);
    if (!libre) {
        return {
            ok: false as const,
            status: 400,
            message: 'Libre Office is not configured in settings.',
        };
    }
    return { ok: true as const, apiKey, libre };
};

/**
 * GET /api/chat-llm/libreoffice/desktop
 * Desktop frontend origin from user settings (e.g. http://localhost:3010).
 */
router.get('/desktop', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const resolved = await resolveLibreOffice(res.locals.auth_userId);
        if (!resolved.ok) {
            return res.status(resolved.status).json({ message: resolved.message });
        }
        const desktopUrl = `${resolved.libre.desktopUrl}/`;
        const desktopAuthUrl = libreOfficeDesktopAuthUrl({
            desktopUrl,
            username: resolved.libre.basicAuthUsername,
            password: resolved.libre.basicAuthPassword,
        });
        return res.json({
            success: true,
            desktopUrl,
            desktopAuthUrl,
        });
    } catch (error) {
        console.error('libreoffice desktop error:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to load Libre Office desktop URL',
        });
    }
});

/**
 * POST /api/chat-llm/libreoffice/open
 * 1) Download the file from the shell workspace
 * 2) Upload it to ai-notes-xyz-libreoffice (same relative folder structure)
 * 3) Open that uploaded file in Libre Office
 * Body JSON: { relativePath }
 */
router.post('/open', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const rawPath = typeof req.body?.relativePath === 'string' ? req.body.relativePath : '';
        console.log('[libreoffice/open] body', req.body);
        console.log('[libreoffice/open] rawPath', rawPath, 'userId', String(userId));
        if (!rawPath) {
            return res.status(400).json({ message: 'relativePath is required' });
        }

        const relativePath = sanitizeRelativePath(rawPath);
        const resolved = await resolveLibreOffice(userId);
        if (!resolved.ok) {
            console.log('[libreoffice/open] config failed', resolved);
            return res.status(resolved.status).json({ message: resolved.message });
        }
        console.log('[libreoffice/open] desktopUrl', resolved.libre.desktopUrl);
        console.log('[libreoffice/open] utilsUrl', resolved.libre.utilsUrl);

        const shell = getShellConfig(resolved.apiKey);
        if (!shell) {
            console.log('[libreoffice/open] shell not configured');
            return res.status(400).json({ message: 'Shell Engine is not configured in settings.' });
        }
        console.log('[libreoffice/open] shellUrl', shell.baseUrl);

        const user = await ModelUser.findById(userId).select('username');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const destRelativePath = libreOfficeDestRelativePath({
            username: user.username,
            userId: String(userId),
            relativePath,
        });
        console.log('[libreoffice/open] relativePath', relativePath);
        console.log('[libreoffice/open] destRelativePath', destRelativePath);

        const readResult = await readBufferFromShellEngine({
            baseUrl: shell.baseUrl,
            token: shell.token,
            relativePath,
            timeoutMs: 60_000,
        });
        console.log('[libreoffice/open] download from shell', {
            ok: readResult.ok,
            status: 'status' in readResult ? readResult.status : undefined,
            error: 'error' in readResult ? readResult.error : undefined,
            bytes: readResult.ok ? readResult.buffer.length : 0,
        });
        if (!readResult.ok) {
            return res.status(400).json({
                message: `Download from shell failed: ${readResult.error}`,
            });
        }

        const fileName = path.posix.basename(relativePath) || 'file';
        const writeResult = await uploadBufferToLibreOffice({
            utilsUrl: resolved.libre.utilsUrl,
            token: resolved.libre.token,
            relativePath: destRelativePath,
            buffer: readResult.buffer,
            fileName,
            timeoutMs: 60_000,
        });
        console.log('[libreoffice/open] upload to libreoffice', writeResult);
        if (!writeResult.ok) {
            return res.status(400).json({
                message: writeResult.error,
            });
        }

        const openResult = await openFileInLibreOffice({
            utilsUrl: resolved.libre.utilsUrl,
            token: resolved.libre.token,
            relativePath: destRelativePath,
            timeoutMs: 30_000,
        });
        console.log('[libreoffice/open] open file', openResult);
        if (!openResult.ok) {
            return res.status(400).json({
                message: openResult.error,
                destRelativePath,
                desktopUrl: `${resolved.libre.desktopUrl}/`,
            });
        }

        return res.json({
            success: true,
            message: `Opened ${fileName} in Libre Office`,
            relativePath,
            destRelativePath,
            desktopUrl: `${resolved.libre.desktopUrl}/`,
        });
    } catch (error) {
        console.log('[libreoffice/open] catch Server error');
        console.log(error);
        console.error('libreoffice open error:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Server error',
        });
    }
});

export default router;
