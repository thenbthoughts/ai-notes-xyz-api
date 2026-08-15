export const AGENT_WORKSPACE_APP = 'ai-notes-xyz-agent-workspace';
export const AGENT_WORKSPACE_ROOT = 'ai-notes-xyz-agent-workspace';
export const AGENT_WORKSPACE_SHELL_FOLDER = 'shell';
export const AGENT_WORKSPACE_FEATURES_FOLDER = 'features';
export const AGENT_WORKSPACE_SHELL_PREFIX = `${AGENT_WORKSPACE_ROOT}/${AGENT_WORKSPACE_SHELL_FOLDER}`;
export const AGENT_WORKSPACE_FEATURES_PREFIX = `${AGENT_WORKSPACE_ROOT}/${AGENT_WORKSPACE_FEATURES_FOLDER}`;
export const AGENT_WORKSPACE_CONTAINER_STORAGE = '/config';

export function agentWorkspaceTaskFilesDir(chatId: string): string {
    const safe = String(chatId || 'unknown').replace(/[^a-fA-F0-9]/g, '').slice(0, 64) || 'unknown';
    return `${AGENT_WORKSPACE_SHELL_PREFIX}/agent/${safe}`;
}
