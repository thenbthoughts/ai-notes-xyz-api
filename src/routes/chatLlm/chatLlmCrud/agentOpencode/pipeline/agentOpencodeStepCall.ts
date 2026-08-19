import {
    AGENT_OPENCODE_ANSWER_FILE,
    AGENT_OPENCODE_RUN_TIMEOUT_MS,
} from '../agentOpencodeConstants';
import {
    agentOpencodeExecute,
    agentOpencodeReadFile,
    parseOpencodeRunText,
    type AgentOpencodeShellConfig,
} from '../agentOpencodeWorkspace';
import type { AgentOpencodePipelinePaths } from './agentOpencodeStepInput';

export const agentOpencodeStepCall = async ({
    promptText,
    shell,
    paths,
    cliModel,
}: {
    promptText: string;
    shell: AgentOpencodeShellConfig;
    paths: AgentOpencodePipelinePaths;
    cliModel: string;
}): Promise<{ text: string }> => {
    const instruction = [
        'You are working in an isolated agent-workspace directory. The current working directory is that folder.',
        'Complete the user instruction below. Create or edit files in this directory if the task needs them.',
        'Use relative paths only (example: hello.txt or ANSWER.md). Do not write to / or other absolute roots.',
        `When finished, write the complete final user-facing answer in Markdown to ${AGENT_OPENCODE_ANSWER_FILE} in this directory (overwrite if it exists).`,
        'Also print that same Markdown as your last message.',
        '',
        '--- USER INSTRUCTION ---',
        promptText,
        '--- END ---',
    ].join('\n');

    const result = await agentOpencodeExecute({
        shell,
        relativeDir: paths.agentWorkspaceDir,
        model: cliModel,
        instruction,
        timeoutMs: AGENT_OPENCODE_RUN_TIMEOUT_MS,
    });

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

    const answerFromStdout = parseOpencodeRunText(result.stdout).trim();
    const text = answerFromFile || answerFromStdout;
    if (!text) {
        const err =
            result.stderr.trim() ||
            result.error ||
            result.stdout.trim().slice(0, 800) ||
            'OpenCode returned empty output';
        throw new Error(`OpenCode did not return an answer. ${err}`);
    }
    return { text };
};
