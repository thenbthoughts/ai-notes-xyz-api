import { ModelUserApiKey } from '../../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelAgentOpencodeInstance } from '../../../../../schema/schemaChatLlm/SchemaAgentOpencode/SchemaAgentOpencodeInstance.schema';
import { ModelChatLlmThread } from '../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
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
    isOpencodeSessionId,
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

const loadThreadSessionId = async (
    threadId: IAgentOpencodeInstance['threadId']
): Promise<{ sessionId: string; sessionTitle: string }> => {
    const thread = await ModelChatLlmThread.findById(threadId)
        .select('opencodeSessionId threadTitle')
        .lean();
    const fromThread =
        thread && typeof thread.opencodeSessionId === 'string' ? thread.opencodeSessionId.trim() : '';
    let sessionId = isOpencodeSessionId(fromThread) ? fromThread : '';
    if (!sessionId) {
        const prev = await ModelAgentOpencodeInstance.findOne({
            threadId,
            opencodeRunId: { $ne: '' },
        })
            .sort({ createdAtUtc: -1 })
            .select('opencodeRunId')
            .lean();
        const fromInstance =
            prev && typeof prev.opencodeRunId === 'string' ? prev.opencodeRunId.trim() : '';
        sessionId = isOpencodeSessionId(fromInstance) ? fromInstance : '';
    }
    const titleRaw =
        thread && typeof thread.threadTitle === 'string' && thread.threadTitle.trim()
            ? thread.threadTitle.trim()
            : String(threadId);
    const sessionTitle = `AI Notes ${titleRaw}`.slice(0, 80);
    return { sessionId, sessionTitle };
};

const persistSessionId = async ({
    instance,
    sessionId,
}: {
    instance: IAgentOpencodeInstance;
    sessionId: string;
}): Promise<void> => {
    if (!isOpencodeSessionId(sessionId)) {
        return;
    }
    const now = new Date();
    await ModelChatLlmThread.findByIdAndUpdate(instance.threadId, {
        $set: {
            opencodeSessionId: sessionId,
            updatedAtUtc: now,
        },
    });
    await ModelAgentOpencodeInstance.findByIdAndUpdate(instance._id, {
        $set: {
            opencodeRunId: sessionId,
            updatedAtUtc: now,
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
        const { sessionId: existingSessionId, sessionTitle } = await loadThreadSessionId(instance.threadId);

        await setPipelineStep(instance._id, 'input', {
            workspaceRootRelativePath: paths.root,
            inputPromptRelativePath: paths.inputPrompt,
            outputPromptRelativePath: paths.outputPrompt,
            agentWorkspaceRelativePath: paths.agentWorkspaceDir,
        });

        const { promptText, historyMarkdown, uploadedFiles } = await agentOpencodeStepInput({
            instance,
            shell,
            paths,
            apiKeys,
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
            historyMarkdown,
            uploadedFiles,
            shell,
            paths,
            cliModel: settings.cliModel,
            sessionId: existingSessionId,
            sessionTitle,
        });
        await persistSessionId({ instance, sessionId: called.sessionId });

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
                opencodeRunId: isOpencodeSessionId(called.sessionId)
                    ? called.sessionId
                    : existingSessionId,
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
