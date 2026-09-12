import axios from 'axios';

export type CoolifySettings = {
    origin: string;
    token: string;
    projectUuid: string;
    envUuid: string;
    deployKeyUuid: string;
};

const coolHeaders = (token: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
});

const coolCall = async ({
    origin,
    token,
    method,
    path,
    body,
}: {
    origin: string;
    token: string;
    method: 'get' | 'post' | 'patch' | 'delete';
    path: string;
    body?: unknown;
}): Promise<{ status: number; data: any }> => {
    const res = await axios({
        method,
        url: `${origin}/api/v1${path}`,
        headers: coolHeaders(token),
        data: body,
        timeout: 30000,
        validateStatus: () => true,
    });
    return { status: res.status, data: res.data };
};

const coolError = (action: string, status: number, data: any): string => {
    const msg = typeof data?.message === 'string' ? data.message : JSON.stringify(data || {}).slice(0, 300);
    return `Coolify ${action} failed (HTTP ${status}): ${msg}`;
};

/** Find an existing Coolify app whose domains contain the given host. */
const findAppByDomain = async (settings: CoolifySettings, host: string): Promise<string> => {
    const res = await coolCall({ origin: settings.origin, token: settings.token, method: 'get', path: '/applications' });
    if (res.status !== 200) {
        return '';
    }
    const raw = res.data?.data ?? res.data?.applications ?? res.data;
    const apps: Array<any> = Array.isArray(raw) ? raw : [];
    const needle = host.toLowerCase();
    const found = apps.find((a) => String(a?.domains ?? a?.fqdn ?? '').toLowerCase().includes(needle));
    return String(found?.uuid ?? '').trim();
};

/** First server uuid on this Coolify instance. App creation needs it. */
const firstServerUuid = async (settings: CoolifySettings): Promise<string> => {
    const res = await coolCall({ origin: settings.origin, token: settings.token, method: 'get', path: '/servers' });
    if (res.status !== 200) {
        throw new Error(coolError('list servers', res.status, res.data));
    }
    const raw = res.data?.data ?? res.data?.servers ?? res.data;
    const servers: Array<any> = Array.isArray(raw) ? raw : [];
    const uuid = String(servers[0]?.uuid ?? '').trim();
    if (!uuid) {
        throw new Error('Coolify has no servers. Connect a server in Coolify first.');
    }
    return uuid;
};

/** Environment display name for an env uuid. Used because create accepts name and uuid. */
const environmentName = async (settings: CoolifySettings): Promise<string> => {
    const res = await coolCall({ origin: settings.origin, token: settings.token, method: 'get', path: `/projects/${encodeURIComponent(settings.projectUuid)}/${encodeURIComponent(settings.envUuid)}` });
    if (res.status !== 200) {
        return '';
    }
    const data = res.data?.data ?? res.data;
    return String(data?.name ?? '').trim();
};

/** What Coolify actually stored for an app's repo field. */
const storedGitRepo = async (settings: CoolifySettings, appUuid: string): Promise<string> => {
    const res = await coolCall({ origin: settings.origin, token: settings.token, method: 'get', path: `/applications/${encodeURIComponent(appUuid)}` });
    if (res.status !== 200) {
        return '';
    }
    const data = res.data?.data ?? res.data;
    return String(data?.git_repository ?? '').trim();
};

/**
 * Best-effort runtime env delivery. Tries POST then PATCH per key; anything the
 * Coolify version rejects lands in `failed` and the caller prints manual steps.
 * Never throws — a missing env API must not fail the deploy.
 */
const trySetAppEnvs = async (
    settings: CoolifySettings,
    appUuid: string,
    vars: Record<string, string>
): Promise<{ applied: string[]; failed: string[] }> => {
    const applied: string[] = [];
    const failed: string[] = [];
    for (const [key, value] of Object.entries(vars)) {
        if (!value) {
            continue;
        }
        let ok = false;
        try {
            const post = await coolCall({
                origin: settings.origin, token: settings.token, method: 'post',
                path: `/applications/${encodeURIComponent(appUuid)}/envs`,
                body: { key, value },
            });
            ok = post.status === 200 || post.status === 201;
            if (!ok) {
                const patch = await coolCall({
                    origin: settings.origin, token: settings.token, method: 'patch',
                    path: `/applications/${encodeURIComponent(appUuid)}/envs`,
                    body: { key, value },
                });
                ok = patch.status === 200 || patch.status === 201 || patch.status === 204;
            }
        } catch {
            ok = false;
        }
        if (ok) {
            applied.push(key);
        } else {
            failed.push(key);
        }
    }
    return { applied, failed };
};

/**
 * Create the Coolify application dynamically, or reuse the one already on this domain.
 * The source is always the PUBLIC template repo (no token, nothing to strip).
 * The app repo URL + branch arrive as RUNTIME env, delivered best-effort via API
 * with manual fallback printed into notes.
 */
const provisionDynamicApp = async ({
    settings,
    name,
    description,
    templateRepo,
    templateBranch,
    branch,
    domain,
    port,
    envVars,
    manualHints,
}: {
    settings: CoolifySettings;
    name: string;
    description: string;
    templateRepo: string;
    templateBranch: string;
    branch: string;
    domain: string;
    port: number;
    envVars: Record<string, string>;
    manualHints: Record<string, string>;
}): Promise<{ uuid: string; created: boolean; notes: string[] }> => {
    const notes: string[] = [];
    // Login lives inside the container (Caddy), so there is exactly one login popup.
    // Fresh apps answer user/user until the env below is set by hand in Coolify, then restarted.
    notes.push('App login is user/user until BASIC_AUTH_USER + BASIC_AUTH_PASSWORD are set in this Coolify app env (values are on the project Setting page), then Restart.');
    const applyEnvs = async (uuid: string): Promise<void> => {
        const result = await trySetAppEnvs(settings, uuid, envVars);
        if (result.applied.length > 0) {
            notes.push(`Coolify env set by API: ${result.applied.join(', ')}.`);
        }
        if (result.failed.length > 0) {
            const lines = result.failed.map((key) => {
                const hint = manualHints[key] ? ` (${manualHints[key]})` : '';
                return `${key}${hint}`;
            });
            notes.push(`Set by hand in Coolify app env, then Restart: ${lines.join('; ')}.`);
        }
    };
    const existing = await findAppByDomain(settings, domain);
    if (existing) {
        const patchRes = await coolCall({
            origin: settings.origin, token: settings.token, method: 'patch', path: `/applications/${encodeURIComponent(existing)}`,
            body: { git_repository: templateRepo, git_branch: templateBranch },
        });
        if (patchRes.status !== 200 && patchRes.status !== 204) {
            throw new Error(coolError('point existing app at template', patchRes.status, patchRes.data));
        }
        notes.push('Coolify app found for domain, pointed at template.');
        notes.push(`Coolify stored repo=${await storedGitRepo(settings, existing) || '(empty)'}.`);
        await applyEnvs(existing);
        return { uuid: existing, created: false, notes };
    }
    const host = domain.replace(/^https?:\/\//i, '').split('/')[0];
    const serverUuid = await firstServerUuid(settings);
    const envName = await environmentName(settings);
    const body: Record<string, unknown> = {
        project_uuid: settings.projectUuid,
        server_uuid: serverUuid,
        environment_uuid: settings.envUuid,
        git_repository: templateRepo,
        git_branch: templateBranch,
        build_pack: 'dockerfile',
        name: name.slice(0, 80),
        description: description.slice(0, 500),
        domains: `https://${host}`,
        ports_exposes: String(port),
        is_auto_deploy_enabled: true,
        is_force_https_enabled: true,
        health_check_enabled: true,
        health_check_path: '/health',
        limits_memory: '512m',
        limits_cpus: '0.5',
        instant_deploy: true,
    };
    if (envName) {
        body.environment_name = envName;
    }
    let res = await coolCall({ origin: settings.origin, token: settings.token, method: 'post', path: '/applications/public', body });
    if (res.status === 400 && JSON.stringify(res.data || {}).toLowerCase().includes('limit')) {
        const retryBody = { ...body };
        delete retryBody.limits_memory;
        delete retryBody.limits_cpus;
        res = await coolCall({ origin: settings.origin, token: settings.token, method: 'post', path: '/applications/public', body: retryBody });
    }
    if (res.status !== 201 && res.status !== 200) {
        throw new Error(coolError('create application', res.status, res.data));
    }
    const uuid = String(res.data?.uuid ?? res.data?.data?.uuid ?? '').trim();
    if (!uuid) {
        throw new Error('Coolify created the app but returned no uuid.');
    }
    notes.push(`Coolify app created from template, branch ${branch} via env.`);
    notes.push(`Coolify stored repo=${await storedGitRepo(settings, uuid) || '(empty)'}.`);
    await applyEnvs(uuid);
    return { uuid, created: true, notes };
};

/** Read back what Coolify stored for an app (repo, branch, status) for the build log. */
const appSourceSummary = async (settings: CoolifySettings, appUuid: string): Promise<string> => {
    const res = await coolCall({ origin: settings.origin, token: settings.token, method: 'get', path: `/applications/${encodeURIComponent(appUuid)}` });
    if (res.status !== 200) {
        return `Coolify app readback failed (HTTP ${res.status}).`;
    }
    const data = res.data?.data ?? res.data;
    const repo = String(data?.git_repository ?? '').trim() || '(empty)';
    const branch = String(data?.git_branch ?? '').trim() || '(empty)';
    const status = String(data?.status ?? '').trim() || '(unknown)';
    return `Coolify stored repo=${repo} branch=${branch} status=${status}.`;
};

/** Queue a fresh deployment for an app uuid. */
const triggerDeploy = async (settings: CoolifySettings, appUuid: string): Promise<string> => {
    const res = await coolCall({ origin: settings.origin, token: settings.token, method: 'post', path: '/deploy', body: { uuid: appUuid } });
    if (res.status !== 200) {
        throw new Error(coolError('trigger deploy', res.status, res.data));
    }
    const list = res.data?.deployments ?? res.data?.data?.deployments ?? [];
    const first = Array.isArray(list) ? list[0] : null;
    return String(first?.deployment_uuid ?? '').trim();
};

export {
    appSourceSummary,
    coolCall,
    findAppByDomain,
    provisionDynamicApp,
    triggerDeploy,
    trySetAppEnvs,
};
