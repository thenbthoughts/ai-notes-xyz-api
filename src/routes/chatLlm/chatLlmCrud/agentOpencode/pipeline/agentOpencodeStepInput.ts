import type { IAgentOpencodeInstance } from '../../../../../types/typesSchema/typesChatLlm/typesAgentOpencode/SchemaAgentOpencodeInstance.types';
import { AGENT_OPENCODE_STARTED_MESSAGE } from '../agentOpencodeConstants';
import {
    agentOpencodeWriteFile,
    agentOpencodeWorkspacePaths,
    type AgentOpencodeShellConfig,
} from '../agentOpencodeWorkspace';

export type AgentOpencodePipelinePaths = ReturnType<typeof agentOpencodeWorkspacePaths>;

export const agentOpencodeStepInput = async ({
    instance,
    shell,
    paths,
}: {
    instance: IAgentOpencodeInstance;
    shell: AgentOpencodeShellConfig;
    paths: AgentOpencodePipelinePaths;
}): Promise<{ promptText: string }> => {
    const promptText = instance.promptText?.trim() ? instance.promptText.trim() : '(empty prompt)';

    await agentOpencodeWriteFile({
        shell,
        relativePath: paths.inputPrompt,
        buffer: Buffer.from(`${promptText}\n`, 'utf8'),
        mimeType: 'text/markdown',
    });

    await agentOpencodeWriteFile({
        shell,
        relativePath: paths.agentWorkspaceKeep,
        buffer: Buffer.from('', 'utf8'),
        mimeType: 'text/plain',
    });

    await agentOpencodeWriteFile({
        shell,
        relativePath: paths.outputPrompt,
        buffer: Buffer.from(`${AGENT_OPENCODE_STARTED_MESSAGE}\n`, 'utf8'),
        mimeType: 'text/markdown',
    });

    return { promptText };
};
