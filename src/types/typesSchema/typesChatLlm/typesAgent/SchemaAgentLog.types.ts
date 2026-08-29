import mongoose, { Document } from 'mongoose';

export type AgentLogLevel = 'info' | 'warn' | 'error' | 'debug';

/** Stable action keys for filtering / UI badges. */
export type AgentLogAction =
    | 'agent_started'
    | 'agent_stopped'
    | 'agent_completed'
    | 'agent_cancelled'
    | 'agent_error'
    | 'tick_start'
    | 'tick_end'
    | 'llm_call_start'
    | 'llm_call_end'
    | 'llm_call_error'
    | 'llm_decision'
    | 'goal_started'
    | 'goal_completed'
    | 'goal_failed'
    | 'domain_search'
    | 'memory_written'
    | 'message_posted'
    | 'excel_created'
    | 'excel_fallback'
    | 'shell_ping'
    | 'shell_upload'
    | 'shell_download'
    | 'shell_execute'
    | 'shell_execute_file'
    | 'shell_error'
    | 'noop'
    | 'status'
    | 'other';

export interface IAgentLog extends Document {
    _id: mongoose.Types.ObjectId;
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    level: AgentLogLevel;
    action: AgentLogAction | string;
    /** Short list-row title shown by default in the UI. */
    title: string;
    /** Longer human-readable summary (shown in expanded detail). */
    message: string;
    /** Structured extras for the detail panel. */
    payload: Record<string, unknown>;
    /**
     * Unstructured / raw dump for deep debugging (LLM body, shell stdout,
     * full error stacks, provider JSON, etc.). May be string or object.
     */
    raw: unknown;
    goalId: mongoose.Types.ObjectId | null;
    tickNumber: number;
    /** Copied from a previous instance for context. Do not count toward usage. */
    past: boolean;
    createdAtUtc: Date;
}
