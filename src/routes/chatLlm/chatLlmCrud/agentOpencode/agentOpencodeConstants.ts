export const ANSWER_ENGINE_AGENT_OPENCODE = 'agentOpencode' as const;

export const AGENT_OPENCODE_CHAT_TAG = 'agentOpencode';

export const AGENT_OPENCODE_STARTED_MESSAGE =
    'Agent (Opencode) started. Workspace will be initialized shortly.';

export const AGENT_OPENCODE_SETTINGS_MESSAGE =
    'Agent (Opencode) started. Copying Groq / OpenRouter keys into OpenCode settings...';

export const AGENT_OPENCODE_RUNNING_MESSAGE =
    'Agent (Opencode) started. Calling OpenCode with the instruction...';

/** OpenCode writes the chat answer here at thread root (cleared each turn). */
export const AGENT_OPENCODE_ANSWER_FILE = 'ANSWER.md';

/** Full thread transcript written into the thread root. */
export const AGENT_OPENCODE_CHAT_FILE = 'CHAT.md';

/** Chat attachments copied into the OpenCode working directory. */
export const AGENT_OPENCODE_UPLOADS_DIR = 'uploads';

export const AGENT_OPENCODE_RUN_TIMEOUT_MS = 300_000;

/** Default max time for an Agent (Opencode) run: 1 hour. */
export const AGENT_OPENCODE_DEFAULT_MAX_ANSWER_TIME_MS = 3_600_000;

/** Hard cap for an Agent (Opencode) run: 24 hours. */
export const AGENT_OPENCODE_MAX_ANSWER_TIME_MS = 24 * 60 * 60 * 1000;

export type AgentOpencodePipelineStep = 'input' | 'settings' | 'opencode' | 'output' | 'done';
