import { agentOpencodeRunPipeline } from './pipeline/agentOpencodeRunPipeline';
import type { IAgentOpencodeInstance } from '../../../../types/typesSchema/typesChatLlm/typesAgentOpencode/SchemaAgentOpencodeInstance.types';

/** Cron entry: input -> copy keys into OpenCode settings -> opencode run -> output. */
const agentOpencodeCreateWorkspaceFiles = async (
    instance: IAgentOpencodeInstance
): Promise<boolean> => {
    return agentOpencodeRunPipeline(instance);
};

export default agentOpencodeCreateWorkspaceFiles;
