import type { IAgentOpencodeInstance } from '../../../../../types/typesSchema/typesChatLlm/typesAgentOpencode/SchemaAgentOpencodeInstance.types';
import type { tsUserApiKey } from '../../../../../utils/llm/llmCommonFunc';
import {
    AGENT_OPENCODE_CHAT_FILE,
    AGENT_OPENCODE_STARTED_MESSAGE,
} from '../agentOpencodeConstants';
import { buildAgentOpencodeChatHistoryMarkdown } from '../agentOpencodeChatHistory';
import { syncAgentOpencodeUploads } from '../agentOpencodeSyncUploads';
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
    apiKeys,
}: {
    instance: IAgentOpencodeInstance;
    shell: AgentOpencodeShellConfig;
    paths: AgentOpencodePipelinePaths;
    apiKeys?: tsUserApiKey | null;
}): Promise<{ promptText: string; historyMarkdown: string; uploadedFiles: string[] }> => {
    const promptText = instance.promptText?.trim() ? instance.promptText.trim() : '(empty prompt)';

    const uploads = await syncAgentOpencodeUploads({
        userId: instance.userId,
        threadId: instance.threadId,
        shell,
        paths,
        apiKeys,
    });

    const { markdown: historyMarkdown } = await buildAgentOpencodeChatHistoryMarkdown({
        threadId: instance.threadId,
        userId: instance.userId,
        skipChatMessageId: instance.chatMessageId,
        currentPrompt: promptText,
        uploads,
    });

    await agentOpencodeWriteFile({
        shell,
        relativePath: paths.inputPrompt,
        buffer: Buffer.from(`${promptText}\n`, 'utf8'),
        mimeType: 'text/markdown',
    });

    await agentOpencodeWriteFile({
        shell,
        relativePath: paths.chatHistory,
        buffer: Buffer.from(historyMarkdown, 'utf8'),
        mimeType: 'text/markdown',
    });

    await agentOpencodeWriteFile({
        shell,
        relativePath: paths.inputChatHistory,
        buffer: Buffer.from(historyMarkdown, 'utf8'),
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

    return {
        promptText,
        historyMarkdown,
        uploadedFiles: uploads.map((item) => item.workspaceRelPath),
    };
};
