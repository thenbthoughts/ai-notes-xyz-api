import { Router, Request, Response } from 'express';
import path from 'path';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { ModelUserApiKey } from '../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';
import {
    getLibreOfficeConfig,
    libreOfficeDesktopAuthUrl,
    openFileInLibreOffice,
} from '../../../utils/libreOffice/libreOfficeConfig';
import { AGENT_WORKSPACE_ROOT } from '../../../utils/agentWorkspace/agentWorkspacePaths';

const router = Router();

const sanitizeRelativePath = (rawDir: string): string => {
    let clean = (rawDir || '').replace(/\\/g, '/').trim();
    if (!clean || clean === '.' || clean === '/') {
        throw new Error('relativePath is required');
    }
    clean = clean.replace(/^\/+/, '');
    if (clean.includes('..')) {
        throw new Error('Invalid path: path cannot contain ..');
    }
    if (!clean.startsWith(AGENT_WORKSPACE_ROOT)) {
        clean = `${AGENT_WORKSPACE_ROOT}/${clean}`;
    }
    return clean;
};

const resolveAgentWorkspace = async (userId: unknown) => {
    const apiKeyDoc = await ModelUserApiKey.findOne({ userId });
    if (!apiKeyDoc) {
        return { ok: false as const, status: 400, message: 'User API keys not found' };
    }
    const apiKey = getApiKeyByObject(apiKeyDoc);
    const workspace = getLibreOfficeConfig(apiKey);
    if (!workspace) {
        return {
            ok: false as const,
            status: 400,
            message: 'Agent Workspace is not configured in settings.',
        };
    }
    return { ok: true as const, apiKey, workspace };
};

/**
 * GET /api/chat-llm/libreoffice/desktop
 * Desktop frontend origin from user settings (e.g. http://localhost:3010).
 */
router.get('/desktop', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const resolved = await resolveAgentWorkspace(res.locals.auth_userId);
        if (!resolved.ok) {
            return res.status(resolved.status).json({ message: resolved.message });
        }
        const desktopUrl = `${resolved.workspace.desktopUrl}/`;
        const desktopAuthUrl = libreOfficeDesktopAuthUrl({
            desktopUrl,
            username: resolved.workspace.basicAuthUsername,
            password: resolved.workspace.basicAuthPassword,
        });
        return res.json({
            success: true,
            desktopUrl,
            desktopAuthUrl,
        });
    } catch (error) {
        console.error('agent workspace desktop error:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to load Agent Workspace desktop URL',
        });
    }
});

/**
 * POST /api/chat-llm/libreoffice/open
 * Open a workspace file in desktop LibreOffice (same container).
 * Body JSON: { relativePath }
 */
router.post('/open', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const rawPath = typeof req.body?.relativePath === 'string' ? req.body.relativePath : '';
        if (!rawPath) {
            return res.status(400).json({ message: 'relativePath is required' });
        }

        const relativePath = sanitizeRelativePath(rawPath);
        const resolved = await resolveAgentWorkspace(res.locals.auth_userId);
        if (!resolved.ok) {
            return res.status(resolved.status).json({ message: resolved.message });
        }

        const fileName = path.posix.basename(relativePath) || 'file';
        const openResult = await openFileInLibreOffice({
            utilsUrl: resolved.workspace.utilsUrl,
            token: resolved.workspace.token,
            relativePath,
            timeoutMs: 30_000,
        });
        if (!openResult.ok) {
            return res.status(400).json({
                message: openResult.error,
                relativePath,
                desktopUrl: `${resolved.workspace.desktopUrl}/`,
            });
        }

        return res.json({
            success: true,
            message: `Opened ${fileName} in Agent Workspace`,
            relativePath,
            desktopUrl: `${resolved.workspace.desktopUrl}/`,
        });
    } catch (error) {
        console.error('agent workspace open error:', error);
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Server error',
        });
    }
});

export default router;
