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

/** Full thread transcript written into the OpenCode working directory. */
export const AGENT_OPENCODE_CHAT_FILE = 'CHAT.md';

/** Full run instruction written to disk so the CLI does not treat it as a --file path. */
export const AGENT_OPENCODE_INSTRUCTION_FILE = 'INSTRUCTION.md';

/** Chat attachments copied into the OpenCode working directory. */
export const AGENT_OPENCODE_UPLOADS_DIR = 'uploads';

export const AGENT_OPENCODE_RUN_TIMEOUT_MS = 300_000;

export type AgentOpencodePipelineStep = 'input' | 'settings' | 'opencode' | 'output' | 'done';
