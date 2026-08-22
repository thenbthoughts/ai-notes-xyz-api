const DEFAULT_CLIENT_ORIGIN = 'http://localhost:3000';

const toOrigin = (raw: string): string => {
    const trimmed = String(raw || '').trim().replace(/\/+$/, '');
    if (!trimmed) return DEFAULT_CLIENT_ORIGIN;
    try {
        const withProto = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
        return new URL(withProto).origin;
    } catch {
        return DEFAULT_CLIENT_ORIGIN;
    }
};

/** Browser-facing webhook origin, e.g. http://localhost:3000/api/webhook */
export const webhookPublicBaseUrl = (clientFrontendUrl: string): string =>
    `${toOrigin(clientFrontendUrl)}/api/webhook`;

/**
 * URL OpenCode should call from Agent Workspace Docker.
 * localhost on the host becomes host.docker.internal inside the container.
 */
export const webhookAgentBaseUrl = (clientFrontendUrl: string): string => {
    try {
        const u = new URL(toOrigin(clientFrontendUrl));
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
            u.hostname = 'host.docker.internal';
        }
        return `${u.origin}/api/webhook`;
    } catch {
        return 'http://host.docker.internal:3000/api/webhook';
    }
};
