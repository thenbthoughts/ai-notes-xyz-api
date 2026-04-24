import mongoose from 'mongoose';
import type { tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';

import {
    runOpencodeTasksForChatTurn,
    runOpencodeTasksFromPlannedList,
} from '../../chatLlmAgent/opencodeTaskOrchestrator';
import type { OpencodePlannedTask } from '../../chatLlmAgent/opencodeTaskPlanner';

import { decomposeAndClassifyTasks } from './decomposeAndClassifyTasks';
import { runLlmSubtasks } from './runLlmSubtasks';
import type { ConciseOpencodePipelineResult, LlmPlannerConfigInput } from './conciseOpencodeTypes';

function formatDecompositionTrace(
    steps: { title: string; instruction: string; channel: string }[]
): string {
    if (steps.length === 0) return '';
    return steps
        .map((s, i) => `${i + 1}. [${s.channel}] ${s.title}\n   ${s.instruction}`)
        .join('\n\n');
}

/**
 * Decompose → classify (OpenCode vs LLM) → run both arms → return structured data for the final model turn.
 * If classification fails or yields no steps, falls back to the legacy one-shot OpenCode planner + runner.
 */
export async function runConciseOpencodePipeline({
    username,
    threadId,
    userApiKey,
    triggerMessageId,
    answerMachineRecordId,
    llm,
    systemPromptPrefix,
    userPrompt,
}: {
    username: string;
    threadId: mongoose.Types.ObjectId;
    userApiKey: tsUserApiKey;
    triggerMessageId?: mongoose.Types.ObjectId;
    /** When invoked from the answer machine, links OpenCode task rows to the AM record. */
    answerMachineRecordId?: mongoose.Types.ObjectId;
    llm: LlmPlannerConfigInput;
    systemPromptPrefix: string;
    userPrompt: string;
}): Promise<ConciseOpencodePipelineResult> {
    const decompose = await decomposeAndClassifyTasks({
        userPrompt,
        systemPromptPrefix,
        llm,
    });

    if (decompose.errorReason || decompose.steps.length === 0) {
        const legacy = await runOpencodeTasksForChatTurn({
            username,
            threadId,
            userApiKey,
            triggerMessageId,
            answerMachineRecordId,
            llmPlannerConfig: llm,
            systemPromptPrefix,
            userPrompt,
        });
        return {
            decompositionTrace: decompose.errorReason
                ? `(Decompose failed; used legacy OpenCode plan.)\n${decompose.errorReason}`
                : '(No decomposed steps; used legacy OpenCode plan.)',
            opencode: {
                plannedCount: legacy.plannedCount,
                executedCount: legacy.executedCount,
                taskIds: legacy.taskIds,
                summaryText: legacy.summaryText,
                errorReason: legacy.errorReason,
                outputFileRefs: legacy.outputFileRefs,
            },
            llmSubtasks: [],
            pipelineError: decompose.errorReason,
        };
    }

    const trace = formatDecompositionTrace(decompose.steps);
    const opencodeTasks: OpencodePlannedTask[] = decompose.steps
        .filter((s) => s.channel === 'opencode')
        .map((s) => ({ title: s.title, instruction: s.instruction }));
    const llmOnly = decompose.steps.filter((s) => s.channel === 'llm');

    let opencodeRes: {
        plannedCount: number;
        executedCount: number;
        taskIds: mongoose.Types.ObjectId[];
        summaryText: string;
        errorReason: string;
        outputFileRefs: ConciseOpencodePipelineResult['opencode']['outputFileRefs'];
    } = {
        plannedCount: 0,
        executedCount: 0,
        taskIds: [],
        summaryText: '',
        errorReason: '',
        outputFileRefs: [],
    };
    if (opencodeTasks.length > 0) {
        opencodeRes = await runOpencodeTasksFromPlannedList({
            username,
            threadId,
            userApiKey,
            triggerMessageId,
            answerMachineRecordId,
            tasks: opencodeTasks,
        });
    }

    const llmRes =
        llmOnly.length > 0
            ? await runLlmSubtasks(llmOnly, { systemPromptPrefix, llm })
            : [];

    return {
        decompositionTrace: trace,
        opencode: {
            plannedCount: opencodeRes.plannedCount,
            executedCount: opencodeRes.executedCount,
            taskIds: opencodeRes.taskIds,
            summaryText: opencodeRes.summaryText,
            errorReason: opencodeRes.errorReason,
            outputFileRefs: opencodeRes.outputFileRefs,
        },
        llmSubtasks: llmRes,
        pipelineError: '',
    };
}
