import {
    AGENT_OPENCODE_ANSWER_FILE,
    AGENT_OPENCODE_CHAT_FILE,
    AGENT_OPENCODE_INSTRUCTION_FILE,
    AGENT_OPENCODE_RUN_TIMEOUT_MS,
    AGENT_OPENCODE_UPLOADS_DIR,
} from '../agentOpencodeConstants';
import {
    agentOpencodeExecute,
    agentOpencodeReadFile,
    agentOpencodeWriteFile,
    parseOpencodeRunText,
    type AgentOpencodeShellConfig,
} from '../agentOpencodeWorkspace';
import type { AgentOpencodePipelinePaths } from './agentOpencodeStepInput';
import { buildUserLibraryMcpContext, type UserLibraryCounts } from '../../../../../utils/mcp/userLibraryCounts';

const buildInstruction = ({
    promptText,
    historyMarkdown,
    uploadedFiles,
    hasSession,
    libraryContext,
}: {
    promptText: string;
    historyMarkdown: string;
    uploadedFiles: string[];
    hasSession: boolean;
    libraryContext: string;
}): string => {
    const fileLines =
        uploadedFiles.length > 0
            ? uploadedFiles.map((rel) => `- ${rel}`).join('\n')
            : `(none under ${AGENT_OPENCODE_UPLOADS_DIR}/)`;

    if (hasSession) {
        return [
            'You are continuing an existing OpenCode session for this chat thread.',
            'The working directory is the isolated agent-workspace folder.',
            `The full transcript is also in ${AGENT_OPENCODE_CHAT_FILE}. Attached files:`,
            fileLines,
            'Use relative paths only. Do not write to / or other absolute roots.',
            `${AGENT_OPENCODE_ANSWER_FILE} was cleared for this turn. Overwrite it with a new Markdown answer for the NEW USER MESSAGE only. Do not copy or repeat a previous answer.`,
            'Also print that same Markdown as your last message.',
            libraryContext,
            '',
            '--- NEW USER MESSAGE ---',
            promptText,
            '--- END ---',
        ].join('\n');
    }

    return [
        'You are working in an isolated agent-workspace directory. The current working directory is that folder.',
        'This is the start of an OpenCode session for this chat thread. Add the conversation below to the session.',
        `The same transcript is in ${AGENT_OPENCODE_CHAT_FILE}. Attached files:`,
        fileLines,
        'Complete the latest user message. Create or edit files in this directory if the task needs them.',
            'Use relative paths only (example: hello.txt or ANSWER.md). Do not write to / or other absolute roots.',
            `When finished, write the complete final user-facing answer in Markdown to ${AGENT_OPENCODE_ANSWER_FILE} in this directory. Answer only the CURRENT USER MESSAGE.`,
            'Also print that same Markdown as your last message.',
            libraryContext,
        '',
        '--- CHAT HISTORY ---',
        historyMarkdown,
        '--- END HISTORY ---',
        '',
        '--- CURRENT USER MESSAGE ---',
        promptText,
        '--- END ---',
    ].join('\n');
};

const oneLine = (value: string, max = 400): string =>
    value.replace(/\s+/g, ' ').trim().slice(0, max);

const buildCliPrompt = (promptText: string): string =>
    [
        `Latest user message: ${oneLine(promptText, 500)}`,
        `Use MCP search if the user library in ${AGENT_OPENCODE_INSTRUCTION_FILE} is relevant.`,
        `Write the complete Markdown answer to ${AGENT_OPENCODE_ANSWER_FILE}.`,
        'Do not reply that you read the instruction. Produce the actual answer.',
    ].join(' ');

const normalizeForCompare = (value: string): string =>
    value.replace(/\s+/g, ' ').trim().toLowerCase();

const isSameAsPreviousAnswer = (next: string, previous: string): boolean => {
    const a = normalizeForCompare(next);
    const b = normalizeForCompare(previous);
    if (!a || !b) return false;
    if (a === b) return true;
    return a.length > 80 && b.length > 80 && (a.includes(b) || b.includes(a));
};

const isInstructionAck = (value: string): boolean => {
    const n = normalizeForCompare(value);
    if (!n) return true;
    if (n.length < 80) return true;
    if (/instruction\.md/.test(n) && n.length < 400) return true;
    if (/i have read/.test(n) && /follow/.test(n) && n.length < 400) return true;
    if (/will follow it/.test(n) && n.length < 200) return true;
    return false;
};

const isUsableAnswer = (value: string, previous: string): boolean => {
    const text = value.trim();
    if (!text) return false;
    if (isInstructionAck(text)) return false;
    if (isSameAsPreviousAnswer(text, previous)) return false;
    return true;
};

const pickUsableStdout = (stdout: string, previous: string): string => {
    const raw = parseOpencodeRunText(stdout).trim();
    if (isUsableAnswer(raw, previous)) return raw;
    return '';
};

const readAnswer = async ({
    shell,
    paths,
    stdout,
    previous,
}: {
    shell: AgentOpencodeShellConfig;
    paths: AgentOpencodePipelinePaths;
    stdout: string;
    previous: string;
}): Promise<string> => {
    let answerFromFile = '';
    try {
        answerFromFile = (
            await agentOpencodeReadFile({
                shell,
                relativePath: `${paths.agentWorkspaceDir}/${AGENT_OPENCODE_ANSWER_FILE}`,
            })
        ).trim();
    } catch {
        answerFromFile = '';
    }
    if (isUsableAnswer(answerFromFile, previous)) {
        return answerFromFile;
    }
    return pickUsableStdout(stdout, previous);
};

export const agentOpencodeStepCall = async ({
    promptText,
    historyMarkdown,
    uploadedFiles,
    shell,
    paths,
    cliModel,
    sessionId,
    sessionTitle,
    libraryCounts,
    previousAnswerText,
}: {
    promptText: string;
    historyMarkdown: string;
    uploadedFiles: string[];
    shell: AgentOpencodeShellConfig;
    paths: AgentOpencodePipelinePaths;
    cliModel: string;
    sessionId?: string;
    sessionTitle?: string;
    libraryCounts: UserLibraryCounts;
    previousAnswerText?: string;
}): Promise<{ text: string; sessionId: string }> => {
    const existingSessionId = String(sessionId || '').trim();
    const libraryContext = buildUserLibraryMcpContext(libraryCounts);
    const prior = (previousAnswerText || '').trim();
    const answerPath = `${paths.agentWorkspaceDir}/${AGENT_OPENCODE_ANSWER_FILE}`;
    const cliPrompt = buildCliPrompt(promptText);
    const run = async (nextSessionId: string) => {
        const hasSession = Boolean(nextSessionId);
        const instruction = buildInstruction({
            promptText,
            historyMarkdown,
            uploadedFiles,
            hasSession,
            libraryContext,
        });
        await agentOpencodeWriteFile({
            shell,
            relativePath: paths.instructionFile,
            buffer: Buffer.from(`${instruction}\n`, 'utf8'),
            mimeType: 'text/markdown',
        });
        await agentOpencodeWriteFile({
            shell,
            relativePath: answerPath,
            buffer: Buffer.from('', 'utf8'),
            mimeType: 'text/markdown',
        });
        return agentOpencodeExecute({
            shell,
            relativeDir: paths.agentWorkspaceDir,
            model: cliModel,
            instruction: cliPrompt,
            timeoutMs: AGENT_OPENCODE_RUN_TIMEOUT_MS,
            sessionId: nextSessionId || undefined,
            sessionTitle: nextSessionId ? undefined : sessionTitle,
        });
    };

    let result = await run(existingSessionId);
    let text = await readAnswer({ shell, paths, stdout: result.stdout, previous: prior });
    let resolvedSessionId = result.sessionId || existingSessionId;

    if (!isUsableAnswer(text, prior)) {
        result = await run('');
        text = await readAnswer({ shell, paths, stdout: result.stdout, previous: prior });
        resolvedSessionId = result.sessionId || resolvedSessionId;
    }

    if (!isUsableAnswer(text, prior)) {
        const err =
            result.stderr.trim() ||
            result.error ||
            result.stdout.trim().slice(0, 800) ||
            'OpenCode returned empty output';
        throw new Error(`OpenCode did not return an answer. ${err}`);
    }

    return { text, sessionId: resolvedSessionId };
};
