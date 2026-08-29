import {
    agentOpencodeReadFile,
    agentOpencodeWriteFile,
    type AgentOpencodeShellConfig,
} from '../agentOpencodeWorkspace';
import { AGENT_OPENCODE_STARTED_MESSAGE } from '../agentOpencodeConstants';
import type { AgentOpencodePipelinePaths } from './agentOpencodeStepInput';

export const agentOpencodeStepOutput = async ({
    shell,
    paths,
    answerText,
}: {
    shell: AgentOpencodeShellConfig;
    paths: AgentOpencodePipelinePaths;
    answerText: string;
}): Promise<{ outputContent: string }> => {
    const outputBody = answerText.trim() || AGENT_OPENCODE_STARTED_MESSAGE;

    await agentOpencodeWriteFile({
        shell,
        relativePath: paths.outputPrompt,
        buffer: Buffer.from(`${outputBody}\n`, 'utf8'),
        mimeType: 'text/markdown',
    });

    let outputContent = outputBody;
    try {
        outputContent = await agentOpencodeReadFile({
            shell,
            relativePath: paths.outputPrompt,
        });
    } catch (err) {
        console.error('agentOpencodeStepOutput output read failed:', err);
    }

    return { outputContent };
};
