import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelDappsProject } from '../../schema/schemaDapps/SchemaDappsProject.schema';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import { appSourceSummary, provisionDynamicApp, triggerDeploy, type CoolifySettings } from './dappsCoolify';
import { buildDappsEnvFile, buildTemplateCloneCommand, DAPPS_TEMPLATE_BRANCH, DAPPS_TEMPLATE_REPO } from './dappsWorkspace';

const router = Router();

const defaultBaseDomain = (): string => {
    const raw = String(process.env.DAPPS_BASE_DOMAIN || 'dapps.example.com').trim().replace(/\/+$/, '');
    return raw || 'dapps.example.com';
};

const userBaseDomain = async (userId: string): Promise<string> => {
    try {
        const doc = await ModelUserApiKey.findOne({ userId }).lean();
        const custom = String((doc as any)?.dappsBaseDomain || '').trim().toLowerCase();
        if (custom && custom.includes('.')) {
            return custom;
        }
    } catch {
        // ignore, fall back to default
    }
    return defaultBaseDomain();
};

const slugifyAppName = (name: string): string => {
    const base = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';
    const rand = crypto.randomBytes(2).toString('hex');
    return `${base}-${rand}`;
};

const prodUrlFor = (slug: string, baseDomain: string): string => {
    return `https://${slug}.${baseDomain}`;
};

const devUrlFor = (slug: string, baseDomain: string): string => {
    return `https://dev.${slug}.${baseDomain}`;
};

// List my apps
router.get(
    '/list',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const search = String(req.query?.search || '').trim();
            const filter: any = { userId: res.locals.auth_userId };
            if (search) {
                filter.name = { $regex: search, $options: 'i' };
            }
            const items = await ModelDappsProject.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
            return res.json({ items });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Create + configure app, host slots are created by agent/coolify later
router.post(
    '/create',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const name = String(req.body?.name || '').trim().slice(0, 80);
            if (!name) {
                return res.status(400).json({ message: 'App name is required' });
            }
            const description = String(req.body?.description || '').trim().slice(0, 2000);
            const stackHintRaw = String(req.body?.stackHint || 'auto').trim().toLowerCase();
            const stackHint = stackHintRaw === 'static' || stackHintRaw === 'node' || stackHintRaw === 'python' ? stackHintRaw : 'auto';
            const portRaw = Number(req.body?.port);
            const port = Number.isFinite(portRaw) && portRaw > 0 ? Math.round(portRaw) : 3000;
            const slug = slugifyAppName(name);
            const gitRepo = String(req.body?.gitRepo || `app-${slug}`).trim().slice(0, 100) || `app-${slug}`;
            const basicAuthUsername = String(req.body?.basicAuthUsername || 'user').trim().slice(0, 80) || 'user';
            const basicAuthPassword = String(req.body?.basicAuthPassword || '').trim() || crypto.randomBytes(9).toString('base64url');
            const manageToken = crypto.randomBytes(12).toString('base64url');
            const baseDomain = await userBaseDomain(String(res.locals.auth_userId));
            const doc = await ModelDappsProject.create({
                userId: res.locals.auth_userId,
                name,
                slug,
                description,
                stackHint,
                port,
                basicAuthUsername,
                basicAuthPassword,
                manageToken,
                gitRepo,
                prodUrl: prodUrlFor(slug, baseDomain),
                devUrl: devUrlFor(slug, baseDomain),
                prodStatus: 'pending',
                devStatus: 'pending',
                starred: false,
            });
            return res.json({ item: doc });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Detail by id
router.get(
    '/by-id/:id',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const doc = await ModelDappsProject.findOne({ _id: req.params.id, userId: res.locals.auth_userId }).lean();
            if (!doc) {
                return res.status(404).json({ message: 'Not found' });
            }
            return res.json({ item: doc });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Update setting for one app
router.post(
    '/update/:id',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const patch: any = {};
            if (typeof req.body?.name === 'string' && req.body.name.trim()) {
                patch.name = String(req.body.name).trim().slice(0, 80);
            }
            if (typeof req.body?.description === 'string') {
                patch.description = String(req.body.description).trim().slice(0, 2000);
            }
            if (typeof req.body?.port !== 'undefined') {
                const p = Number(req.body.port);
                if (Number.isFinite(p) && p > 0) {
                    patch.port = Math.round(p);
                }
            }
            if (typeof req.body?.basicAuthUsername === 'string' && req.body.basicAuthUsername.trim()) {
                patch.basicAuthUsername = String(req.body.basicAuthUsername).trim().slice(0, 80);
            }
            if (typeof req.body?.basicAuthPassword === 'string' && req.body.basicAuthPassword.trim()) {
                patch.basicAuthPassword = String(req.body.basicAuthPassword).trim().slice(0, 200);
            }
            if (typeof req.body?.manageToken === 'string' && req.body.manageToken.trim()) {
                patch.manageToken = String(req.body.manageToken).trim().slice(0, 200);
            }
            if (typeof req.body?.starred === 'boolean') {
                patch.starred = req.body.starred;
            }
            if (typeof req.body?.prodStatus === 'string' && ['pending', 'building', 'live', 'failed'].includes(req.body.prodStatus)) {
                patch.prodStatus = req.body.prodStatus;
            }
            if (typeof req.body?.devStatus === 'string' && ['pending', 'building', 'live', 'failed'].includes(req.body.devStatus)) {
                patch.devStatus = req.body.devStatus;
            }
            const doc = await ModelDappsProject.findOneAndUpdate(
                { _id: req.params.id, userId: res.locals.auth_userId },
                { $set: patch },
                { new: true }
            ).lean();
            if (!doc) {
                return res.status(404).json({ message: 'Not found' });
            }
            return res.json({ item: doc });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Promote dev to prod: merge dev branch to main, push, ensure Coolify prod app with domain, deploy.
router.post(
    '/promote/:id',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const project = await ModelDappsProject.findOne({ _id: req.params.id, userId: res.locals.auth_userId });
            if (!project) {
                return res.status(404).json({ message: 'Not found' });
            }
            const keys = await ModelUserApiKey.findOne({ userId: res.locals.auth_userId }).lean();
            if (!keys || !(keys as any).dappsValid) {
                return res.status(400).json({ message: 'DApps settings are not valid.' });
            }
            const gitProvider = String((keys as any).dappsGitProvider || 'gitea').toLowerCase() === 'github' ? 'github' : 'gitea';
            const gitOrigin = String((keys as any).dappsGitUrl || '').trim().replace(/\/+$/, '');
            const gitToken = String((keys as any).dappsGitToken || '').trim();
            const resolvedOwner = String((keys as any).dappsGitOwner || '').trim();
            const repoName = String((project as any).gitRepo || '').trim();
            if (!gitOrigin || !gitToken || !resolvedOwner || !repoName) {
                return res.status(400).json({ message: 'Git settings or repo name are missing.' });
            }
            let shellBase = String((keys as any).agentWorkspaceApiUrl || '').trim().replace(/\/+$/, '');
            let shellToken = String((keys as any).agentWorkspaceApiToken || '').trim();
            if (!shellBase || !shellToken) {
                shellBase = String(process.env.AM4_SHELL_ENGINE_URL || process.env.SHELL_ENGINE_URL || '').trim().replace(/\/+$/, '');
                shellToken = String(process.env.AM4_SHELL_ENGINE_TOKEN || process.env.SHELL_ENGINE_TOKEN || '').trim();
            }
            if (!shellBase || !shellToken) {
                return res.status(400).json({ message: 'Agent Workspace is not configured.' });
            }
            await ModelDappsProject.updateOne({ _id: project._id }, { $set: { prodStatus: 'building' } });

            const safeDir = `ai-notes-xyz-agent-workspace/shell/dapps/${String(project._id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
            const remoteUrl = `${gitOrigin}/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repoName)}.git`;
            const authedUrl = remoteUrl.replace('https://', `https://${encodeURIComponent(resolvedOwner)}:${encodeURIComponent(gitToken)}@`);
            const shQ = (s: string): string => `'${String(s).replace(/'/g, `'\\''`)}'`;
            const mergeCommand = [
                'ROOT="${FILE_STORAGE_PATH:-/config}"',
                `DIR="$ROOT"/${shQ(safeDir)}`,
                'cd "$DIR/code"',
                `git remote set-url origin ${shQ(authedUrl)}`,
                'git fetch origin dev main || true',
                'git checkout -B main origin/main 2>/dev/null || git checkout -B main',
                'git merge origin/dev -m "promote dev to prod" || git merge dev -m "promote dev to prod"',
                'git push -u origin main',
                `git remote set-url origin ${shQ(remoteUrl)}`,
                'git log --oneline -3',
            ].join('\n');
            const mergeRes = await axios.post(
                `${shellBase}/api/shell-engine/run-shell/execute`,
                { command: mergeCommand, timeoutMs: 120000, treatStderrAsFailure: false },
                {
                    timeout: 140000,
                    headers: { 'X-API-Token': shellToken, 'Content-Type': 'application/json' },
                    validateStatus: () => true,
                }
            );
            const mergeBody = mergeRes.data && typeof mergeRes.data === 'object' ? mergeRes.data as Record<string, unknown> : {};
            const mergeText = `${typeof mergeBody.stdout === 'string' ? mergeBody.stdout : ''}\n${typeof mergeBody.stderr === 'string' ? mergeBody.stderr : ''}`.split(gitToken).join('***').trim();
            if (mergeRes.status !== 200) {
                await ModelDappsProject.updateOne({ _id: project._id }, { $set: { prodStatus: 'failed' } });
                const failed = await ModelDappsProject.findOne({ _id: project._id, userId: res.locals.auth_userId }).lean();
                return res.status(500).json({ item: failed, message: `Promote merge failed: ${mergeText.slice(0, 500)}` });
            }

            const coolifyOrigin = String((keys as any).dappsCoolifyUrl || '').trim().replace(/\/+$/, '');
            const coolifyToken = String((keys as any).dappsCoolifyToken || '').trim();
            const coolifyProjectUuid = String((keys as any).dappsCoolifyProjectProd || '').trim();
            const coolifyEnvUuid = String((keys as any).dappsCoolifyEnvironmentProd || '').trim();
            const deployKeyUuid = String((keys as any).dappsDeployKeyUuid || '').trim();
            if (!coolifyOrigin || !coolifyToken || !coolifyProjectUuid || !coolifyEnvUuid) {
                await ModelDappsProject.updateOne({ _id: project._id }, { $set: { prodStatus: 'failed' } });
                return res.status(400).json({ message: 'Coolify base URL, token, prod project ID, or prod environment ID is missing in DApps settings.' });
            }
            const coolSettings: CoolifySettings = {
                origin: coolifyOrigin,
                token: coolifyToken,
                projectUuid: coolifyProjectUuid,
                envUuid: coolifyEnvUuid,
                deployKeyUuid,
            };
            const appTitle = String((project as any).name || 'App').slice(0, 80);
            const gitHost = gitOrigin.replace(/^https?:\/\//i, '').split('/')[0];
            const gitRepoWithPat = `https://${encodeURIComponent(gitToken)}@${gitHost}/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repoName)}.git`;
            const prodDomain = String((project as any).prodUrl || '').replace(/^https?:\/\//i, '').split('/')[0];
            const ensured = await provisionDynamicApp({
                settings: coolSettings,
                name: `${appTitle} prod`.slice(0, 80),
                description: `DApps prod for ${repoName}`,
                templateRepo: DAPPS_TEMPLATE_REPO,
                templateBranch: DAPPS_TEMPLATE_BRANCH,
                branch: 'main',
                domain: prodDomain,
                port: 3000,
                envVars: {
                    APP_REPO_URL: gitRepoWithPat,
                    APP_BRANCH: 'main',
                    BASIC_AUTH_USER: String((project as any).basicAuthUsername || 'user'),
                    BASIC_AUTH_PASSWORD: String((project as any).basicAuthPassword || ''),
                },
                manualHints: {
                    APP_REPO_URL: 'https://<git-token>@host/owner/repo.git, token is the Group A git token',
                    APP_BRANCH: 'main',
                    BASIC_AUTH_USER: 'value is on project Setting page',
                    BASIC_AUTH_PASSWORD: 'value is on project Setting page',
                },
            });
            await ModelDappsProject.updateOne({ _id: project._id }, { $set: { coolifyAppUuidProd: ensured.uuid } });
            const deploymentUuid = await triggerDeploy(coolSettings, ensured.uuid);
            const doc = await ModelDappsProject.findOne({ _id: project._id, userId: res.locals.auth_userId }).lean();
            const loginNote = 'Prod login is user/user until BASIC_AUTH_USER + BASIC_AUTH_PASSWORD are set in the Coolify prod app env (values are in project Setting), then Restart.';
            return res.json({ item: doc, message: deploymentUuid ? `Prod merged and deploy queued (${deploymentUuid}). Open prod URL in 2-4 mins. ${loginNote}` : `Prod merged and deploy queued. Open prod URL in 2-4 mins. ${loginNote}` });
        } catch (error) {
            console.error(error);
            const msg = error instanceof Error ? error.message : String(error);
            return res.status(500).json({ message: `Promote failed: ${msg}` });
        }
    }
);

// Delete app
router.post(
    '/delete/:id',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            await ModelDappsProject.deleteOne({ _id: req.params.id, userId: res.locals.auth_userId });
            return res.json({ success: true });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Build dev: clone the public template into shell/dapps/{id}/code on first build,
// push dev branch to git, create the Coolify dev app with its domain, deploy it.
// Resend retries from the Coolify step and never wipes the agent's work.
router.post(
    '/build/:id',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const prompt = String(req.body?.prompt || '').trim().slice(0, 2000);
            const project = await ModelDappsProject.findOne({ _id: req.params.id, userId: res.locals.auth_userId });
            if (!project) {
                return res.status(404).json({ message: 'Not found' });
            }
            const keys = await ModelUserApiKey.findOne({ userId: res.locals.auth_userId }).lean();
            if (!keys || !(keys as any).dappsValid) {
                return res.status(400).json({ message: 'DApps settings are not valid. Open /user/setting/api-key DApps tab first.' });
            }
            const gitProvider = String((keys as any).dappsGitProvider || 'gitea').toLowerCase() === 'github' ? 'github' : 'gitea';
            const gitOrigin = String((keys as any).dappsGitUrl || '').trim().replace(/\/+$/, '');
            const gitToken = String((keys as any).dappsGitToken || '').trim();
            const gitOwner = String((keys as any).dappsGitOwner || '').trim();
            if (!gitOrigin || !gitToken) {
                return res.status(400).json({ message: 'Git URL and token are required in DApps settings.' });
            }
            let shellBase = String((keys as any).agentWorkspaceApiUrl || '').trim().replace(/\/+$/, '');
            let shellToken = String((keys as any).agentWorkspaceApiToken || '').trim();
            if (!shellBase || !shellToken) {
                shellBase = String(process.env.AM4_SHELL_ENGINE_URL || process.env.SHELL_ENGINE_URL || '').trim().replace(/\/+$/, '');
                shellToken = String(process.env.AM4_SHELL_ENGINE_TOKEN || process.env.SHELL_ENGINE_TOKEN || '').trim();
            }
            if (!shellBase || !shellToken) {
                return res.status(400).json({ message: 'Agent Workspace is not configured. Set it in /user/setting/api-key first.' });
            }

            await ModelDappsProject.updateOne({ _id: project._id }, { $set: { devStatus: 'building' } });

            const safeId = String(project._id);
            const safeDir = `ai-notes-xyz-agent-workspace/shell/dapps/${safeId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
            const appTitle = String(project.name || 'App').replace(/</g, '').slice(0, 80);
            const appPrompt = prompt || String((project as any).description || '');
            const appPort = Number((project as any).port) > 0 ? Math.round(Number((project as any).port)) : 3000;
            const repoName = String((project as any).gitRepo || `app-${(project as any).slug || safeId}`).trim() || `app-${safeId}`;

            const maskToken = (text: string): string => {
                if (!text || !gitToken) {
                    return text;
                }
                return text.split(gitToken).join('***').split(encodeURIComponent(gitToken)).join('***');
            };

            // Ensure git repo exists so push has somewhere to go.
            let resolvedOwner = gitOwner;
            try {
                if (gitProvider === 'gitea') {
                    const meRes = await axios.get(`${gitOrigin}/api/v1/user`, {
                        headers: { Authorization: `token ${gitToken}` },
                        timeout: 20000,
                    });
                    const login = String(meRes.data?.login || '').trim();
                    if (login && !resolvedOwner) {
                        resolvedOwner = login;
                    }
                    if (resolvedOwner) {
                        const repoCheck = await axios.get(`${gitOrigin}/api/v1/repos/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repoName)}`, {
                            headers: { Authorization: `token ${gitToken}` },
                            timeout: 20000,
                            validateStatus: () => true,
                        });
                        if (repoCheck.status === 404) {
                            await axios.post(`${gitOrigin}/api/v1/user/repos`, {
                                name: repoName,
                                private: true,
                                auto_init: false,
                            }, {
                                headers: { Authorization: `token ${gitToken}`, 'Content-Type': 'application/json' },
                                timeout: 20000,
                            });
                        }
                    }
                } else {
                    const apiBase = gitOrigin.includes('github.com') ? 'https://api.github.com' : `${gitOrigin}/api/v3`;
                    const meRes = await axios.get(`${apiBase}/user`, {
                        headers: { Authorization: `Bearer ${gitToken}`, Accept: 'application/vnd.github+json' },
                        timeout: 20000,
                    });
                    const login = String(meRes.data?.login || '').trim();
                    if (login && !resolvedOwner) {
                        resolvedOwner = login;
                    }
                    if (resolvedOwner) {
                        const repoCheck = await axios.get(`${apiBase}/repos/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repoName)}`, {
                            headers: { Authorization: `Bearer ${gitToken}`, Accept: 'application/vnd.github+json' },
                            timeout: 20000,
                            validateStatus: () => true,
                        });
                        if (repoCheck.status === 404) {
                            await axios.post(`${apiBase}/user/repos`, {
                                name: repoName,
                                private: true,
                                auto_init: false,
                            }, {
                                headers: { Authorization: `Bearer ${gitToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
                                timeout: 20000,
                            });
                        }
                    }
                }
            } catch (repoErr) {
                const msg = repoErr instanceof Error ? repoErr.message : String(repoErr);
                await ModelDappsProject.updateOne({ _id: project._id }, { $set: { devStatus: 'failed', devLog: `Git repo check failed: ${msg}`.slice(0, 8000), devBuiltAt: new Date() } });
                return res.status(400).json({ message: `Git repo check failed: ${msg}` });
            }
            if (!resolvedOwner) {
                await ModelDappsProject.updateOne({ _id: project._id }, { $set: { devStatus: 'failed', devLog: 'Git owner is empty and could not be read from token.', devBuiltAt: new Date() } });
                return res.status(400).json({ message: 'Git owner is empty and could not be read from token.' });
            }

            const remoteUrl = gitProvider === 'gitea'
                ? `${gitOrigin}/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repoName)}.git`
                : gitOrigin.includes('github.com')
                    ? `https://github.com/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repoName)}.git`
                    : `${gitOrigin}/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repoName)}.git`;
            const authedUrl = remoteUrl.replace('https://', `https://${encodeURIComponent(resolvedOwner)}:${encodeURIComponent(gitToken)}@`);

            // First build clones the public template (Caddy + Node 24 + /health). Resend keeps
            // the agent's work and pushes again. The agent later writes only dappsfe/dappsbe.
            const chatMd = `# ${appTitle}\n\nBuild prompt:\n\n${appPrompt}\n`;
            const envFile = buildDappsEnvFile({
                mongodbUri: '',
                appId: safeId,
                appPort,
                basicAuthUsername: String((project as any).basicAuthUsername || 'user'),
                basicAuthPassword: String((project as any).basicAuthPassword || ''),
                manageToken: String((project as any).manageToken || ''),
            });
            const command = buildTemplateCloneCommand({ safeDir, authedUrl, remoteUrl, chatMd, envFile });

            let execOk = false;
            let execText = '';
            try {
                const execRes = await axios.post(
                    `${shellBase}/api/shell-engine/run-shell/execute`,
                    { command, timeoutMs: 300000, treatStderrAsFailure: false },
                    {
                        timeout: 320000,
                        headers: { 'X-API-Token': shellToken, 'Content-Type': 'application/json' },
                        validateStatus: () => true,
                    }
                );
                const body = execRes.data && typeof execRes.data === 'object' ? execRes.data as Record<string, unknown> : {};
                const stdout = typeof body.stdout === 'string' ? body.stdout : '';
                const stderr = typeof body.stderr === 'string' ? body.stderr : '';
                execText = maskToken(`${stdout}\n${stderr}`.trim()).slice(0, 8000);
                execOk = execRes.status === 200 && /push|->|branch|commit|listening|create mode/i.test(execText);
                if (execRes.status !== 200 && !execText) {
                    execText = maskToken(`Workspace HTTP ${execRes.status}: ${typeof body.message === 'string' ? body.message : 'failed'}`);
                }
            } catch (execErr) {
                execText = maskToken(execErr instanceof Error ? execErr.message : String(execErr)).slice(0, 8000);
                execOk = false;
            }

            if (!execOk) {
                await ModelDappsProject.updateOne(
                    { _id: project._id },
                    { $set: { devStatus: 'failed', devLog: execText || '(empty build log)', devBuiltAt: new Date() } }
                );
                const updated = await ModelDappsProject.findOne({ _id: project._id, userId: res.locals.auth_userId }).lean();
                return res.status(500).json({ item: updated, message: 'Dev build failed in workspace. See dev log.' });
            }

            // Push worked. Now create the dev app in Coolify with the PAT repo URL, read back
            // what Coolify stored, fall back to SSH + deploy key when it strips the URL, and deploy.
            const coolLog: string[] = [`Pushed dev branch to git repo ${resolvedOwner}/${repoName}.`];
            try {
                const coolifyOrigin = String((keys as any).dappsCoolifyUrl || '').trim().replace(/\/+$/, '');
                const coolifyToken = String((keys as any).dappsCoolifyToken || '').trim();
                const coolifyProjectUuid = String((keys as any).dappsCoolifyProject || '').trim();
                const coolifyEnvUuid = String((keys as any).dappsCoolifyEnvironment || '').trim();
                const deployKeyUuid = String((keys as any).dappsDeployKeyUuid || '').trim();
                if (!coolifyOrigin || !coolifyToken || !coolifyProjectUuid || !coolifyEnvUuid) {
                    throw new Error('Coolify base URL, token, project ID, or environment ID is missing in DApps settings.');
                }
                const coolSettings: CoolifySettings = {
                    origin: coolifyOrigin,
                    token: coolifyToken,
                    projectUuid: coolifyProjectUuid,
                    envUuid: coolifyEnvUuid,
                    deployKeyUuid,
                };
                const gitHost = gitOrigin.replace(/^https?:\/\//i, '').split('/')[0];
                const gitRepoWithPat = `https://${encodeURIComponent(gitToken)}@${gitHost}/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repoName)}.git`;
                const devDomain = String((project as any).devUrl || '').replace(/^https?:\/\//i, '').split('/')[0];
                if (appPort !== 3000) {
                    coolLog.push(`Project port ${appPort} ignored, the template always uses port 3000.`);
                }
                const basicUser = String((project as any).basicAuthUsername || 'user');
                const basicPass = String((project as any).basicAuthPassword || '');
                const devManageToken = String((project as any).manageToken || '');
                const ensured = await provisionDynamicApp({
                    settings: coolSettings,
                    name: `${appTitle} dev`.slice(0, 80),
                    description: `DApps dev for ${repoName}`,
                    templateRepo: DAPPS_TEMPLATE_REPO,
                    templateBranch: DAPPS_TEMPLATE_BRANCH,
                    branch: 'dev',
                    domain: devDomain,
                    port: 3000,
                    envVars: {
                        APP_REPO_URL: gitRepoWithPat,
                        APP_BRANCH: 'dev',
                        BASIC_AUTH_USER: basicUser,
                        BASIC_AUTH_PASSWORD: basicPass,
                        MANAGE_TOKEN: devManageToken,
                    },
                    manualHints: {
                        APP_REPO_URL: 'https://<git-token>@host/owner/repo.git, token is the Group A git token',
                        APP_BRANCH: 'dev',
                        BASIC_AUTH_USER: 'value is on project Setting page',
                        BASIC_AUTH_PASSWORD: 'value is on project Setting page',
                        MANAGE_TOKEN: 'value is on project Setting page',
                    },
                });
                coolLog.push(ensured.created ? `Coolify dev app created with domain ${devDomain}.` : `Coolify dev app found for ${devDomain}, pointed at branch.`);
                for (const note of ensured.notes) {
                    coolLog.push(note);
                }
                await ModelDappsProject.updateOne({ _id: project._id }, { $set: { coolifyAppUuidDev: ensured.uuid } });
                coolLog.push(await appSourceSummary(coolSettings, ensured.uuid));
                const deploymentUuid = await triggerDeploy(coolSettings, ensured.uuid);
                coolLog.push(deploymentUuid ? `Coolify deploy queued (${deploymentUuid}). Open dev URL in 2-4 mins.` : 'Coolify deploy queued. Open dev URL in 2-4 mins.');
            } catch (coolErr) {
                const msg = coolErr instanceof Error ? coolErr.message : String(coolErr);
                coolLog.push(`Coolify step failed: ${msg}`);
                coolLog.push('Fix it, then press Resend again. Resend retries from the Coolify step.');
            }

            const fullLog = `${execText}\n\n--- coolify ---\n${coolLog.join('\n')}`.slice(0, 8000);
            const coolFailed = coolLog.some((l) => l.startsWith('Coolify step failed'));
            await ModelDappsProject.updateOne(
                { _id: project._id },
                { $set: { devStatus: 'building', devLog: fullLog, devBuiltAt: new Date() } }
            );
            const updated = await ModelDappsProject.findOne({ _id: project._id, userId: res.locals.auth_userId }).lean();
            if (coolFailed) {
                return res.json({ item: updated, message: 'Dev pushed to git, but Coolify step failed. See dev log, fix, then Resend.' });
            }
            return res.json({ item: updated, message: 'Dev pushed and Coolify deploy queued. Open dev URL in 2-4 mins.' });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;
