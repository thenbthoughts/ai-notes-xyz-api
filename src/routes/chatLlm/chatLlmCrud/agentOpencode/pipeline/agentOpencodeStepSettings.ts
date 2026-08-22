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
}: {
    shell: AgentOpencodeShellConfig;
    paths: AgentOpencodePipelinePaths;
    apiKeys: tsUserApiKey;
    userId?: string;
    chatMessageId?: string;
}): Promise<{ cliModel: string; providerNames: string[] }> => {
    return writeAgentOpencodeSettingsFiles({ shell, paths, apiKeys, userId, chatMessageId });
};
