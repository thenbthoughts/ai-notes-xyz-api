import envKeys from '../../config/envKeys';

const DEFAULT_API_ORIGIN = 'http://localhost:2000';
const MCP_PATH = '/api/mcp';

const toOrigin = (raw: string): string => {
    const trimmed = String(raw || '').trim().replace(/\/+$/, '');
    if (!trimmed) return DEFAULT_API_ORIGIN;
    try {
        const withProto = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
        return new URL(withProto).origin;
    } catch {
        return DEFAULT_API_ORIGIN;
    }
};

/** Normalize a user-entered MCP URL. Empty string if invalid. */
export const normalizeMcpUrl = (raw: string): string => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    try {
        const withProto = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
        const u = new URL(withProto);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return '';
        }
        const path = (u.pathname || '/').replace(/\/+$/, '');
        if (!path || path === '/' || path === '/api') {
            u.pathname = MCP_PATH;
        }
        u.hash = '';
        u.search = '';
        const finalPath = u.pathname.replace(/\/+$/, '') || MCP_PATH;
        return `${u.origin}${finalPath}`;
    } catch {
        return '';
    }
};

/** Default MCP URL from API_URL, e.g. http://localhost:2000/api/mcp */
export const mcpPublicBaseUrlAuto = (): string => `${toOrigin(envKeys.API_URL)}${MCP_PATH}`;

/** Browser-facing MCP URL: saved value, else API_URL. */
export const mcpPublicBaseUrl = (stored?: string): string =>
    normalizeMcpUrl(stored || '') || mcpPublicBaseUrlAuto();

/**
 * URL OpenCode should call from Agent Workspace Docker.
 * localhost on the host becomes host.docker.internal inside the container.
 */
export const mcpAgentBaseUrl = (stored?: string): string => {
    try {
        const u = new URL(mcpPublicBaseUrl(stored));
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
            u.hostname = 'host.docker.internal';
        }
        return `${u.origin}${u.pathname.replace(/\/+$/, '') || MCP_PATH}`;
    } catch {
        return 'http://host.docker.internal:2000/api/mcp';
    }
};
