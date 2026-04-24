import { fetchLlmUnified, Message } from '../../../utils/llmPendingTask/utils/fetchLlmUnified';
import type { LlmProvider } from '../../../utils/llmPendingTask/utils/fetchLlmUnified';

import {
    OPENCODE_THREAD_SUBDIR_CODEEXECUTION,
    OPENCODE_THREAD_SUBDIR_INPUTFILES,
    OPENCODE_THREAD_SUBDIR_OUTPUTFILES,
} from './utils/opencodeWorkspacePaths';

export interface OpencodePlannedTask {
    title: string;
    instruction: string;
}

function normalizePlannerTasks(input: unknown, maxTasks: number): OpencodePlannedTask[] {
    const list =
        Array.isArray(input)
            ? input
            : input && typeof input === 'object'
            ? Array.isArray((input as any).tasks)
                ? (input as any).tasks
                : Array.isArray((input as any).steps)
                ? (input as any).steps
                : []
            : [];

    return list
        .map((t: any): OpencodePlannedTask => {
            const titleRaw =
                typeof t?.title === 'string'
                    ? t.title
                    : typeof t?.name === 'string'
                    ? t.name
                    : typeof t?.description === 'string'
                    ? t.description
                    : '';
            const instructionRaw =
                typeof t?.instruction === 'string'
                    ? t.instruction
                    : typeof t?.command === 'string'
                    ? t.command
                    : typeof t?.task === 'string'
                    ? t.task
                    : '';
            const title = String(titleRaw || '').trim();
            const instruction = String(instructionRaw || '').trim();
            return {
                title: title || (instruction ? 'Task' : ''),
                instruction,
            };
        })
        .filter((t: OpencodePlannedTask) => t.title.length > 0 && t.instruction.length > 0)
        .slice(0, maxTasks);
}

function extractJsonObject(text: string): string {
    const raw = (text || '').trim();
    if (!raw) return '';
    
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

export async function planOpencodeTasksWithLlm({
    provider,
    apiKey,
    apiEndpoint,
    model,
    systemPromptPrefix,
    userPrompt,
    openCodeWorkspaceDirectory,
    temperature = 0.2,
    maxTasks = 6,
}: {
    provider: LlmProvider;
    apiKey: string;
    apiEndpoint: string;
    model: string;
    systemPromptPrefix: string;
    userPrompt: string;
    /** Thread-scoped OpenCode workspace root; all deliverables must live under this path. */
    openCodeWorkspaceDirectory: string;
    temperature?: number;
    maxTasks?: number;
}): Promise<{ tasks: OpencodePlannedTask[]; errorReason: string; rawText: string }> {
    const ws = (openCodeWorkspaceDirectory || '').trim() || '(workspace root)';
    const systemPrompt = [
        systemPromptPrefix,
        '',
        'You create a small list of executable tasks for OpenCode.',
        'Return STRICT JSON only (no markdown).',
        '',
        'Schema:',
        '{ "tasks": [ { "title": string, "instruction": string } ] }',
        '',
        `Rules:`,
        `- Provide 0..${maxTasks} tasks`,
        `- Tasks must be terminal-friendly or file-generation friendly (e.g. install deps, run commands, generate files)`,
        `- Each instruction must be self-contained.`,
        `- OpenCode session workspace root (absolute path on the OpenCode host): ${ws}`,
        `- Use this layout: ${ws}/${OPENCODE_THREAD_SUBDIR_INPUTFILES} (inputs), ${ws}/${OPENCODE_THREAD_SUBDIR_OUTPUTFILES} (user-facing deliverables), ${ws}/${OPENCODE_THREAD_SUBDIR_CODEEXECUTION} (scripts, venvs, installs).`,
        `- Any files the user must receive MUST be written under ${ws}/${OPENCODE_THREAD_SUBDIR_OUTPUTFILES} or ./${OPENCODE_THREAD_SUBDIR_OUTPUTFILES} relative to the workspace root.`,
        `- For PDFs, images, or other binaries: the final artifact must exist on disk under outputfiles with the real extension (e.g. .pdf), not only a helper script — run the script as needed so the binary is created before the task ends.`,
        `- This environment is externally-managed. ALWAYS create and activate a venv: \`cd ${ws}/${OPENCODE_THREAD_SUBDIR_CODEEXECUTION} && python3 -m venv venv && . venv/bin/activate && pip install --no-cache-dir <pkg>\` then run with \`venv/bin/python script.py\`.`,
        `- Prefer running installs and scratch work under ${ws}/${OPENCODE_THREAD_SUBDIR_CODEEXECUTION}.`,
        `- If the user mentions paths like /app/files-.../output or other locations outside this workspace, rewrite instructions so final artifacts end up in ${ws}/${OPENCODE_THREAD_SUBDIR_OUTPUTFILES}.`,
        `- For PDF generation, use fpdf2 or reportlab. Example: create a script that uses from fpdf import FPDF; pdf = FPDF(); pdf.add_page(); pdf.set_font("Arial", size=12); pdf.cell(200, 10, txt="Hello World " + str(datetime.date.today()), ln=1); pdf.output("hello_world.pdf")`,
    ].join('\n').trim();

    const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    const result = await fetchLlmUnified({
        provider,
        apiKey,
        apiEndpoint,
        model,
        messages,
        temperature,
        maxTokens: 1500,
        // responseFormat: 'json_object', // Some models don't support this via API, rely on system prompt
    });

    const rawText = (result.content || '').trim();
    if (!result.success || rawText.length < 1) {
        return { tasks: [], errorReason: `Planner LLM failed or returned empty output. Error: ${result.error || 'none'}`, rawText };
    }

    const jsonText = extractJsonObject(rawText) || rawText;
    try {
        const parsed = JSON.parse(jsonText);
        const normalized = normalizePlannerTasks(parsed, maxTasks);
        if (normalized.length < 1) {
            return {
                tasks: [],
                errorReason:
                    'Planner returned JSON, but no valid tasks were found (expected tasks/steps array with instruction/command fields)',
                rawText,
            };
        }
        return { tasks: normalized, errorReason: '', rawText };
    } catch (e) {
        return {
            tasks: [],
            errorReason: `Planner returned non-JSON: ${rawText.slice(0, 240)}`,
            rawText,
        };
    }
}

