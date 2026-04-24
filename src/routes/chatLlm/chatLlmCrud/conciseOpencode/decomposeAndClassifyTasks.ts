import { fetchLlmUnified, Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';

import type { ConciseClassifiedSubtask, ConciseSubtaskChannel, LlmPlannerConfigInput } from './conciseOpencodeTypes';

const MAX_STEPS = 8;

const SYSTEM = [
    'You break a user request into ordered subtasks, and assign each subtask a channel.',
    'Return STRICT JSON only (no markdown, no backticks).',
    '',
    'Schema:',
    '{ "steps": [ { "title": string, "instruction": string, "executor": "opencode" | "llm" } ] }',
    '',
    'Channel rules:',
    '- "opencode": must run in a code/shell workspace — install packages, run scripts, read/write project files, generate PDFs/binaries, fetch URLs with curl, process data on disk, anything that needs execution.',
    '- "llm": pure language work only — explain, compare, plan in prose, summarize without needing files, rewrite text, answer from general knowledge, no file creation and no running commands.',
    '',
    'Decomposition rules:',
    `- At most ${MAX_STEPS} steps.`,
    '- Keep instructions self-contained; order matters.',
    '- If the user asks one simple thing, use one step.',
    '- Prefer one opencode task per concrete artifact (e.g. one PDF) unless steps must be sequential.',
].join('\n');

function extractJsonObject(text: string): string {
    const raw = (text || '').trim();
    if (!raw) return '';
    
    // Find the first { or [
    const firstObj = raw.indexOf('{');
    const firstArr = raw.indexOf('[');
    
    let first = -1;
    if (firstObj >= 0 && firstArr >= 0) {
        first = Math.min(firstObj, firstArr);
    } else if (firstObj >= 0) {
        first = firstObj;
    } else if (firstArr >= 0) {
        first = firstArr;
    }
    
    if (first === -1) return '';
    
    const isArray = raw[first] === '[';
    const last = isArray ? raw.lastIndexOf(']') : raw.lastIndexOf('}');
    
    if (last > first) {
        return raw.slice(first, last + 1);
    }
    return '';
}

export type DecomposeClassifyResult = {
    steps: ConciseClassifiedSubtask[];
    errorReason: string;
    rawText: string;
};

function normalizeDecomposeSteps(input: unknown, maxSteps: number): ConciseClassifiedSubtask[] {
    const list =
        Array.isArray(input)
            ? input
            : input && typeof input === 'object'
            ? Array.isArray((input as any).steps)
                ? (input as any).steps
                : Array.isArray((input as any).tasks)
                ? (input as any).tasks
                : []
            : [];

    return list
        .map((s: any): ConciseClassifiedSubtask => {
            const titleRaw =
                typeof s?.title === 'string'
                    ? s.title
                    : typeof s?.name === 'string'
                    ? s.name
                    : typeof s?.description === 'string'
                    ? s.description
                    : '';
            const instructionRaw =
                typeof s?.instruction === 'string'
                    ? s.instruction
                    : typeof s?.command === 'string'
                    ? s.command
                    : typeof s?.task === 'string'
                    ? s.task
                    : '';
            const exRaw =
                typeof s?.executor === 'string'
                    ? s.executor
                    : typeof s?.channel === 'string'
                    ? s.channel
                    : '';
            const channel: ConciseSubtaskChannel =
                exRaw === 'opencode' || exRaw === 'llm'
                    ? exRaw
                    : /install|pip |python|bash|run |create .*file|pdf|script|command/i.test(instructionRaw)
                    ? 'opencode'
                    : 'llm';

            const title = String(titleRaw || '').trim();
            const instruction = String(instructionRaw || '').trim();
            return {
                title: title || (instruction ? 'Task' : ''),
                instruction,
                channel,
            };
        })
        .filter((s: ConciseClassifiedSubtask) => s.title.length > 0 && s.instruction.length > 0)
        .slice(0, maxSteps);
}

/**
 * Step 1 + 2: decompose the user request and label each subtask for OpenCode vs normal LLM.
 */
export async function decomposeAndClassifyTasks(
    {
        userPrompt,
        systemPromptPrefix,
        llm,
        temperature = 0.2,
    }: {
        userPrompt: string;
        systemPromptPrefix: string;
        llm: LlmPlannerConfigInput;
        temperature?: number;
    }
): Promise<DecomposeClassifyResult> {
    const messages: Message[] = [
        { role: 'system', content: [systemPromptPrefix, '', SYSTEM].join('\n').trim() },
        { role: 'user', content: userPrompt },
    ];

    const result = await fetchLlmUnified({
        provider: llm.provider,
        apiKey: llm.apiKey,
        apiEndpoint: llm.apiEndpoint,
        model: llm.model,
        messages,
        temperature,
        maxTokens: 2000,
        // responseFormat: 'json_object', // Some models don't support this via API, rely on system prompt
    });

    const rawText = (result.content || '').trim();
    if (!result.success || rawText.length < 1) {
        return { steps: [], errorReason: `Decompose/classify LLM failed or returned empty output. Error: ${result.error || 'none'}`, rawText };
    }

    const jsonText = extractJsonObject(rawText) || rawText;
    try {
        const parsed = JSON.parse(jsonText);
        const steps = normalizeDecomposeSteps(parsed, MAX_STEPS);
        if (steps.length < 1) {
            return {
                steps: [],
                errorReason:
                    'Decompose returned JSON, but no valid steps were found (expected steps/tasks array with instruction/command fields)',
                rawText,
            };
        }
        return { steps, errorReason: '', rawText };
    } catch {
        return { steps: [], errorReason: 'Decompose returned non-JSON or invalid structure', rawText };
    }
}
