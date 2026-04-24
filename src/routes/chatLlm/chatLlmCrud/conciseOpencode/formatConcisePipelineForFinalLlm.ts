import type { ConciseOpencodePipelineResult } from './conciseOpencodeTypes';

const MAX_LLM_ERR_PER_TASK = 400;

/**
 * Step 4 input: one block the main LLM uses to write the user-visible final answer.
 */
export function formatConcisePipelineDataForFinalLlm(pipeline: ConciseOpencodePipelineResult): string {
    const parts: string[] = [];

    if (pipeline.pipelineError.trim()) {
        parts.push(`[Pipeline note: decompose step reported: ${pipeline.pipelineError.trim()}]`);
    }

    if (pipeline.decompositionTrace.trim()) {
        parts.push(`1) Task decomposition + channel (opencode vs LLM)\n${pipeline.decompositionTrace.trim()}`);
    }

    if (pipeline.opencode.summaryText.trim()) {
        parts.push(
            `2) OpenCode execution summary\n${pipeline.opencode.summaryText.trim()}`
        );
    } else if (pipeline.opencode.errorReason.trim()) {
        parts.push(
            `2) OpenCode execution\nError: ${pipeline.opencode.errorReason.trim()}`
        );
    } else {
        parts.push('2) OpenCode execution\nNo OpenCode subtasks in this run (or no summary).');
    }

    if (pipeline.llmSubtasks.length > 0) {
        const lines = pipeline.llmSubtasks.map((t, i) => {
            if (t.error) {
                return `   ${i + 1}. ${t.title} — error: ${t.error.slice(0, MAX_LLM_ERR_PER_TASK)}`;
            }
            return `   ${i + 1}. ${t.title}\n${t.answer}`;
        });
        parts.push(`3) Normal LLM subtask outputs\n${lines.join('\n\n')}`);
    } else {
        parts.push('3) Normal LLM subtasks\nNone in this run.');
    }

    parts.push(
        '4) Instructions: Synthesize a single clear reply to the user using the above. Prefer facts from OpenCode/LLM subtask results; do not invent file paths or run results.'
    );

    return parts.join('\n\n');
}

export function opencodeFileRefsForPersistence(
    pipeline: ConciseOpencodePipelineResult
): ConciseOpencodePipelineResult['opencode']['outputFileRefs'] {
    return Array.isArray(pipeline.opencode?.outputFileRefs) ? pipeline.opencode.outputFileRefs : [];
}
