export const ANSWER_ENGINE_AGENT_OPENCODE = 'agentOpencode' as const;

export const AGENT_OPENCODE_CHAT_TAG = 'agentOpencode';

export const AGENT_OPENCODE_STARTED_MESSAGE =
    'Agent (Opencode) started. Workspace will be initialized shortly.';

export const AGENT_OPENCODE_SETTINGS_MESSAGE =
    'Agent (Opencode) started. Copying Groq / OpenRouter keys into OpenCode settings...';

export const AGENT_OPENCODE_RUNNING_MESSAGE =
    'Agent (Opencode) started. Calling OpenCode with the instruction...';

/** OpenCode writes the chat answer here inside agent-workspace/. */
export const AGENT_OPENCODE_ANSWER_FILE = 'ANSWER.md';

export const AGENT_OPENCODE_RUN_TIMEOUT_MS = 300_000;

export type AgentOpencodePipelineStep = 'input' | 'settings' | 'opencode' | 'output' | 'done';
