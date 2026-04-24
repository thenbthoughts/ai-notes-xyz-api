import mongoose from 'mongoose';
import type { LlmProvider } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';

export type ConciseSubtaskChannel = 'opencode' | 'llm';

export type ConciseClassifiedSubtask = {
    title: string;
    /** Actionable one-step instruction. */
    instruction: string;
    /** Where this step runs. */
    channel: ConciseSubtaskChannel;
};

export type ConciseLlmSubtaskResult = {
    title: string;
    instruction: string;
    /** Truncated model output. */
    answer: string;
    error?: string;
};

export type LlmPlannerConfigInput = {
    provider: LlmProvider;
    apiKey: string;
    apiEndpoint: string;
    model: string;
};

/**
 * What we inject into the main chat so the final stream can "answer from the data".
 */
export type ConciseOpencodePipelineResult = {
    /** Human-readable trace for debug / UI (optional). */
    decompositionTrace: string;
    opencode: {
        plannedCount: number;
        executedCount: number;
        taskIds: mongoose.Types.ObjectId[];
        summaryText: string;
        errorReason: string;
        outputFileRefs: Array<{
            fileName: string;
            filePath: string;
            contentType: string;
            size: number;
        }>;
    };
    llmSubtasks: ConciseLlmSubtaskResult[];
    /** If decomposition/classification failed; still allow final turn to continue. */
    pipelineError: string;
};
