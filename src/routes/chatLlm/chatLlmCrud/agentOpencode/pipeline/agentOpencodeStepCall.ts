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
            `When finished, write the complete final user-facing answer in Markdown to ${AGENT_OPENCODE_ANSWER_FILE} (overwrite if it exists).`,
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
            `When finished, write the complete final user-facing answer in Markdown to ${AGENT_OPENCODE_ANSWER_FILE} in this directory (overwrite if it exists).`,
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

const cliPrompt = `Read ${AGENT_OPENCODE_INSTRUCTION_FILE} in this directory and follow it exactly.`;

const readAnswer = async ({
    shell,
    paths,
    stdout,
}: {
    shell: AgentOpencodeShellConfig;
    paths: AgentOpencodePipelinePaths;
    stdout: string;
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
    const answerFromStdout = parseOpencodeRunText(stdout).trim();
    return answerFromFile || answerFromStdout;
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
}): Promise<{ text: string; sessionId: string }> => {
    const existingSessionId = String(sessionId || '').trim();
    const libraryContext = buildUserLibraryMcpContext(libraryCounts);
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
    let text = await readAnswer({ shell, paths, stdout: result.stdout });
    let resolvedSessionId = result.sessionId || existingSessionId;

    if (!text && existingSessionId) {
        result = await run('');
        text = await readAnswer({ shell, paths, stdout: result.stdout });
        resolvedSessionId = result.sessionId || resolvedSessionId;
    }

    if (!text) {
        const err =
            result.stderr.trim() ||
            result.error ||
            result.stdout.trim().slice(0, 800) ||
            'OpenCode returned empty output';
        throw new Error(`OpenCode did not return an answer. ${err}`);
    }

    return { text, sessionId: resolvedSessionId };
};
