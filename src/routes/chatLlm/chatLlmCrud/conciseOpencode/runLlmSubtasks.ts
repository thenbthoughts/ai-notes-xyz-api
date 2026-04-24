import { fetchLlmUnified, Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';

import type { ConciseClassifiedSubtask, ConciseLlmSubtaskResult, LlmPlannerConfigInput } from './conciseOpencodeTypes';

const MAX_ANSWER_CHARS = 12_000;

const SUBTASK_SYSTEM = [
    'You are helping inside a multi-step chat pipeline.',
    'Answer only this one subtask. Be concise and direct. No preambles about being an AI.',
].join('\n');

/**
 * Step 3 (LLM channel): run normal-LLM subtasks in order; outputs feed the final answer.
 */
export async function runLlmSubtasks(
    subtasks: ConciseClassifiedSubtask[],
    {
        systemPromptPrefix,
        llm,
        temperature = 0.3,
    }: { systemPromptPrefix: string; llm: LlmPlannerConfigInput; temperature?: number }
): Promise<ConciseLlmSubtaskResult[]> {
    const out: ConciseLlmSubtaskResult[] = [];

    for (const t of subtasks) {
        const messages: Message[] = [
            {
                role: 'system',
                content: [systemPromptPrefix, '', SUBTASK_SYSTEM].join('\n').trim(),
            },
            {
                role: 'user',
                content: `Subtask: ${t.title}\n\n${t.instruction}`,
            },
        ];

        const res = await fetchLlmUnified({
            provider: llm.provider,
            apiKey: llm.apiKey,
            apiEndpoint: llm.apiEndpoint,
            model: llm.model,
            messages,
            temperature,
            maxTokens: 3000,
        });

        const raw = (res.content || '').trim();
        if (!res.success) {
            out.push({
                title: t.title,
                instruction: t.instruction,
                answer: '',
                error: 'LLM subtask call failed or returned empty',
            });
            continue;
        }

        const answer = raw.length > MAX_ANSWER_CHARS ? `${raw.slice(0, MAX_ANSWER_CHARS)}\n…` : raw;
        out.push({ title: t.title, instruction: t.instruction, answer });
    }

    return out;
}
