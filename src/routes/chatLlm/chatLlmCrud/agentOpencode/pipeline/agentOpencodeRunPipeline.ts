import { ModelUserApiKey } from '../../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelAgentOpencodeInstance } from '../../../../../schema/schemaChatLlm/SchemaAgentOpencode/SchemaAgentOpencodeInstance.schema';
import { getApiKeyByObject } from '../../../../../utils/llm/llmCommonFunc';
import {
    AGENT_OPENCODE_RUNNING_MESSAGE,
    AGENT_OPENCODE_SETTINGS_MESSAGE,
} from '../agentOpencodeConstants';
import {
    failAgentOpencodeInstance,
    syncAgentOpencodeChatMessage,
} from '../agentOpencodeChat';
import {
    agentOpencodeWorkspacePaths,
    getAgentOpencodeShellConfig,
} from '../agentOpencodeWorkspace';
import type { IAgentOpencodeInstance } from '../../../../../types/typesSchema/typesChatLlm/typesAgentOpencode/SchemaAgentOpencodeInstance.types';
import { agentOpencodeStepInput } from './agentOpencodeStepInput';
import { agentOpencodeStepSettings } from './agentOpencodeStepSettings';
import { agentOpencodeStepCall } from './agentOpencodeStepCall';
import { agentOpencodeStepOutput } from './agentOpencodeStepOutput';

const setPipelineStep = async (
    instanceId: IAgentOpencodeInstance['_id'],
    pipelineStep: 'input' | 'settings' | 'opencode' | 'output' | 'done',
    extra: Record<string, unknown> = {}
): Promise<void> => {
    await ModelAgentOpencodeInstance.findByIdAndUpdate(instanceId, {
        $set: {
            pipelineStep,
            updatedAtUtc: new Date(),
            ...extra,
        },
    });
};

/**
 * Isolated pipeline: input -> copy env keys to OpenCode settings -> call OpenCode -> output.
 */
export const agentOpencodeRunPipeline = async (
    instance: IAgentOpencodeInstance
): Promise<boolean> => {
    try {
        const userApiKey = await ModelUserApiKey.findOne({ userId: instance.userId });
        const apiKeys = getApiKeyByObject(userApiKey);
        const shell = getAgentOpencodeShellConfig(apiKeys);
        if (!shell) {
            await failAgentOpencodeInstance({
                instance,
                errorReason:
                    'Agent Workspace is not configured. Add a valid Agent Workspace API URL and token in Settings.',
            });
            return true;
        }

        const paths = agentOpencodeWorkspacePaths({
            threadId: String(instance.threadId),
            instanceId: String(instance._id),
        });

        await setPipelineStep(instance._id, 'input', {
            workspaceRootRelativePath: paths.root,
            inputPromptRelativePath: paths.inputPrompt,
            outputPromptRelativePath: paths.outputPrompt,
            agentWorkspaceRelativePath: paths.agentWorkspaceDir,
        });

        const { promptText } = await agentOpencodeStepInput({
            instance,
            shell,
            paths,
        });

        await setPipelineStep(instance._id, 'settings');
        await syncAgentOpencodeChatMessage({
            instance,
            content: AGENT_OPENCODE_SETTINGS_MESSAGE,
        });
        const settings = await agentOpencodeStepSettings({
            shell,
            paths,
            apiKeys,
        });

        await setPipelineStep(instance._id, 'opencode');
        await syncAgentOpencodeChatMessage({
            instance,
            content: AGENT_OPENCODE_RUNNING_MESSAGE,
        });
        const called = await agentOpencodeStepCall({
            promptText,
            shell,
            paths,
            cliModel: settings.cliModel,
        });

        await setPipelineStep(instance._id, 'output');
        const { outputContent } = await agentOpencodeStepOutput({
            shell,
            paths,
            answerText: called.text,
        });

        const now = new Date();
        await ModelAgentOpencodeInstance.findByIdAndUpdate(instance._id, {
            $set: {
                status: 'filesInitialized',
                statusIsRunning: false,
                errorReason: '',
                pipelineStep: 'done',
                workspaceRootRelativePath: paths.root,
                inputPromptRelativePath: paths.inputPrompt,
                outputPromptRelativePath: paths.outputPrompt,
                agentWorkspaceRelativePath: paths.agentWorkspaceDir,
                filesInitializedAtUtc: now,
                updatedAtUtc: now,
            },
        });

        await syncAgentOpencodeChatMessage({
            instance,
            content: outputContent,
        });

        return true;
    } catch (error) {
        console.error(`agentOpencodeRunPipeline (${instance._id}):`, error);
        await failAgentOpencodeInstance({
            instance,
            errorReason: error instanceof Error ? error.message : 'Pipeline failed',
        });
        return true;
    }
};

export default agentOpencodeRunPipeline;
