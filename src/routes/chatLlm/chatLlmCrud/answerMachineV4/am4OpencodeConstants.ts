/**
 * System instructions sent with every AM4 `session.prompt` call to OpenCode.
 * Tells the executor it runs in an Ubuntu 24–based container and may install packages when needed.
 */
export const AM4_OPENCODE_EXECUTOR_SYSTEM = [
    'You run inside a disposable Ubuntu 24-based Docker container with network access.',
    'When a required CLI, library, or tool is missing, you may use non-interactive package management (e.g. `apt-get update` and `apt-get install -y <packages>`). Prefer official distro packages; avoid prompts and destructive actions unless the user explicitly asked.',
    'Use OpenCode tools (read/edit files, run commands) to complete the user’s step; keep answers concise and actionable.',
].join('\n');

/** Hosted OpenCode shell uses `agent: "build"` on `prompt_async` (tooling agent). */
export const AM4_OPENCODE_EXECUTOR_AGENT = 'build';

/**
 * OpenRouter's routing alias `openrouter/auto` is not a stable model id for OpenCode execution.
 * Match `getLlmConfig` OpenRouter default when mapping thread LLM → OpenCode.
 */
export const AM4_OPENROUTER_AUTO_FALLBACK_MODEL_ID = 'openai/gpt-oss-20b';

/** Fallback executor model when thread LLM mapping yields no model (see `opencodeModelFromLlmConfig`). */
export const AM4_OPENCODE_DEFAULT_EXECUTOR_MODEL = {
    providerID: 'opencode',
    modelID: 'big-pickle',
} as const;
