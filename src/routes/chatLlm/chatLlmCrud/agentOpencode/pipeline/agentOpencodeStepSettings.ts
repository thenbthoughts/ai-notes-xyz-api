import type { tsUserApiKey } from '../../../../../utils/llm/llmCommonFunc';
import type { AgentOpencodeShellConfig } from '../agentOpencodeWorkspace';
import type { AgentOpencodePipelinePaths } from './agentOpencodeStepInput';
import { writeAgentOpencodeSettingsFiles } from './agentOpencodeSettings';

export const agentOpencodeStepSettings = async ({
    shell,
    paths,
    apiKeys,
    userId,
    chatMessageId,
    mcpEnabled,
    threadProviderId,
    threadModelName,
}: {
    shell: AgentOpencodeShellConfig;
    paths: AgentOpencodePipelinePaths;
    apiKeys: tsUserApiKey;
    userId?: string;
    chatMessageId?: string;
    mcpEnabled?: boolean;
    threadProviderId?: string;
    threadModelName?: string;
}): Promise<{ cliModel: string; providerNames: string[]; model: { providerID: string; modelID: string; cliModel: string } }> => {
    return writeAgentOpencodeSettingsFiles({ shell, paths, apiKeys, userId, chatMessageId, mcpEnabled, threadProviderId, threadModelName });
};
