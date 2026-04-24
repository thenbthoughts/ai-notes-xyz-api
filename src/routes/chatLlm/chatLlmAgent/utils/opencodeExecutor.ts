import { spawn } from 'child_process';
import vm from 'vm';

type OpencodeRunner = 'opencode' | 'fallback' | null;

export interface OpencodeExecutionResult {
    used: boolean;
    runner: OpencodeRunner;
    output: string;
    skippedReason: string;
}

const MAX_OUTPUT_CHARS = 4000;
const COMMAND_TIMEOUT_MS = 20_000;

function clipText(text: string, maxChars: number = MAX_OUTPUT_CHARS): string {
    if (text.length <= maxChars) {
        return text;
    }
    return `${text.slice(0, maxChars)}\n\n[truncated]`;
}

function looksCodingRelated(question: string): boolean {
    const normalized = question.toLowerCase();
    return [
        'code',
        'bug',
        'error',
        'stack',
        'traceback',
        'function',
        'algorithm',
        'line',
        'compile',
        'syntax',
        'runtime',
        'math',
        'calculate',
        'equation',
        'debug',
        'typescript',
        'javascript',
        'python',
        'sql',
    ].some((keyword) => normalized.includes(keyword));
}

function extractFirstJsCodeBlock(input: string): string {
    const regex = /```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/gi;
    const match = regex.exec(input);
    return match?.[1]?.trim() || '';
}

async function runCommandWithTimeout(
    command: string,
    args: string[],
    timeoutMs: number,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
    return await new Promise((resolve) => {
        const child = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
        });

        let stdout = '';
        let stderr = '';
        let finished = false;

        const timer = setTimeout(() => {
            if (!finished) {
                child.kill('SIGTERM');
                finished = true;
                resolve({
                    success: false,
                    stdout,
                    stderr: `${stderr}\nCommand timed out after ${timeoutMs}ms`,
                });
            }
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            if (finished) return;
            clearTimeout(timer);
            finished = true;
            resolve({
                success: false,
                stdout,
                stderr: `${stderr}\n${error.message}`,
            });
        });

        child.on('close', (code) => {
            if (finished) return;
            clearTimeout(timer);
            finished = true;
            resolve({
                success: code === 0,
                stdout,
                stderr,
            });
        });
    });
}

function tryEvaluateMathExpression(question: string): string {
    const match = question.match(/(?:calculate|compute|evaluate|solve)\s*[:\-]?\s*([0-9+\-*/().%\s]{3,})/i);
    const expression = match?.[1]?.trim() || '';
    if (!expression) {
        return '';
    }
    if (!/[+\-*/%]/.test(expression)) {
        return '';
    }
    if (!/^[0-9+\-*/().%\s]+$/.test(expression)) {
        return '';
    }
    try {
        const result = vm.runInNewContext(expression, { Math }, { timeout: 300 });
        return `Math evaluation\nExpression: ${expression}\nResult: ${String(result)}`;
    } catch (error) {
        return `Math evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
}

function tryExecuteJsSnippet(question: string): string {
    const code = extractFirstJsCodeBlock(question);
    if (!code) {
        return '';
    }
    try {
        const logs: string[] = [];
        const sandbox = {
            Math,
            JSON,
            Number,
            String,
            Boolean,
            Array,
            Object,
            console: {
                log: (...args: unknown[]) => {
                    logs.push(args.map((arg) => String(arg)).join(' '));
                },
            },
        };

        const wrappedCode = `(function () {\n${code}\n})()`;
        const result = vm.runInNewContext(wrappedCode, sandbox, { timeout: 800 });
        const logOutput = logs.length > 0 ? logs.join('\n') : '[no console output]';

        return `JavaScript execution\nResult: ${String(result)}\nLogs:\n${logOutput}`;
    } catch (error) {
        return `JavaScript execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
}

function tryFetchRequestedLine(question: string, contextContent: string): string {
    const lineMatch = question.match(/\bline\s+(\d{1,5})\b/i);
    if (!lineMatch || !lineMatch[1]) {
        return '';
    }
    const lineNumber = parseInt(lineMatch[1], 10);
    if (!Number.isFinite(lineNumber) || lineNumber < 1) {
        return '';
    }

    const lines = contextContent.split('\n');
    if (lineNumber > lines.length) {
        return `Line lookup\nRequested line ${lineNumber}, but context has only ${lines.length} lines.`;
    }
    const line = lines[lineNumber - 1]?.trim() || '';
    return `Line lookup\nLine ${lineNumber}: ${line || '[empty line]'}`;
}

function runFallbackExecution(question: string, contextContent: string): string {
    const chunks = [
        tryEvaluateMathExpression(question),
        tryExecuteJsSnippet(question),
        tryFetchRequestedLine(question, contextContent),
    ].filter((chunk) => chunk.trim().length > 0);

    if (chunks.length === 0) {
        return '';
    }

    return chunks.join('\n\n---\n\n');
}

async function tryRunOpencodeCli({
    question,
    conversationContext,
    contextContent,
}: {
    question: string;
    conversationContext: string;
    contextContent: string;
}): Promise<string> {
    const opencodeBinary = process.env.OPENCODE_BIN || 'opencode';
    const instruction = [
        'You are executing optional coding analysis for an answer engine.',
        'Solve only with deterministic checks where possible.',
        'Return plain text with findings and outputs.',
        '',
        `QUESTION:\n${question}`,
        '',
        `CONVERSATION CONTEXT:\n${conversationContext.slice(0, 2500)}`,
        '',
        `RELEVANT CONTEXT:\n${contextContent.slice(0, 5000)}`,
    ].join('\n');

    const commandCandidates: Array<{ args: string[] }> = [
        { args: ['run', instruction] },
        { args: ['exec', instruction] },
        { args: [instruction] },
    ];

    for (const candidate of commandCandidates) {
        const result = await runCommandWithTimeout(opencodeBinary, candidate.args, COMMAND_TIMEOUT_MS);
        const stdOutSafe = result.stdout.trim();
        if (result.success && stdOutSafe.length > 0) {
            return stdOutSafe;
        }
    }

    return '';
}

export async function runOptionalOpencodeExecution({
    enabled,
    question,
    conversationContext,
    contextContent,
}: {
    enabled: boolean;
    question: string;
    conversationContext: string;
    contextContent: string;
}): Promise<OpencodeExecutionResult> {
    if (!enabled) {
        return {
            used: false,
            runner: null,
            output: '',
            skippedReason: 'disabled',
        };
    }

    if (!looksCodingRelated(question)) {
        return {
            used: false,
            runner: null,
            output: '',
            skippedReason: 'question not coding-related',
        };
    }

    try {
        const opencodeOutput = await tryRunOpencodeCli({
            question,
            conversationContext,
            contextContent,
        });
        if (opencodeOutput.trim().length > 0) {
            return {
                used: true,
                runner: 'opencode',
                output: clipText(opencodeOutput.trim()),
                skippedReason: '',
            };
        }
    } catch (error) {
        console.warn('[OpenCode] CLI execution failed, using fallback:', error);
    }

    const fallbackOutput = runFallbackExecution(question, contextContent);
    if (fallbackOutput.trim().length > 0) {
        return {
            used: true,
            runner: 'fallback',
            output: clipText(fallbackOutput.trim()),
            skippedReason: '',
        };
    }

    return {
        used: false,
        runner: null,
        output: '',
        skippedReason: 'no executable coding task detected',
    };
}
