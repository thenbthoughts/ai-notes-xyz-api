import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAgentOpencodeInstance } from '../../../../schema/schemaChatLlm/SchemaAgentOpencode/SchemaAgentOpencodeInstance.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import {
    ANSWER_ENGINE_AGENT_OPENCODE,
    AGENT_OPENCODE_CHAT_TAG,
    AGENT_OPENCODE_STARTED_MESSAGE,
} from './agentOpencodeConstants';
import {
    agentOpencodeWorkspacePaths,
    getAgentOpencodeShellConfig,
    isOpencodeSessionId,
} from './agentOpencodeWorkspace';
import { opencodeCreateSessionViaShell } from './agentOpencodeServer';
import { opencodeContainerDirectory } from './agentOpencodeServer';

const agentOpencodeInitiate = async ({
    messageId,
}: {
    messageId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    errorReason: string;
    agentOpencodeInstanceId: string | null;
    opencodeSessionId: string | null;
}> => {
    try {
        const message = await ModelChatLlm.findById(messageId);
        if (!message) {
            return { success: false, errorReason: 'Message not found', agentOpencodeInstanceId: null, opencodeSessionId: null };
        }

        const thread = await ModelChatLlmThread.findById(message.threadId);
        if (!thread) {
            return { success: false, errorReason: 'Thread not found', agentOpencodeInstanceId: null, opencodeSessionId: null };
        }

        if (thread.answerEngine !== ANSWER_ENGINE_AGENT_OPENCODE) {
            return {
                success: false,
                errorReason: 'Thread is not configured for Agent (Opencode)',
                agentOpencodeInstanceId: null,
                opencodeSessionId: null,
            };
        }

        const threadObjectId = new mongoose.Types.ObjectId(String(message.threadId));
        const userId = thread.userId as mongoose.Types.ObjectId;
        const now = new Date();

        const previousPending = await ModelAgentOpencodeInstance.find({
            threadId: threadObjectId,
            userId,
            status: 'pending',
        })
            .select('_id')
            .lean();

        if (previousPending.length > 0) {
            await ModelAgentOpencodeInstance.updateMany(
                { _id: { $in: previousPending.map((row) => row._id) } },
                {
                    $set: {
                        status: 'failed',
                        statusIsRunning: false,
                        errorReason: 'Superseded by a new Agent (Opencode) request on this thread.',
                        updatedAtUtc: now,
                    },
                }
            );
        }

        const promptText =
            message.type === 'text' && typeof message.content === 'string'
                ? message.content.trim()
                : '';

        const instance = await ModelAgentOpencodeInstance.create({
            threadId: threadObjectId,
            parentMessageId: messageId,
            chatMessageId: null,
            userId,
            status: 'pending',
            statusIsRunning: false,
            errorReason: '',
            promptText,
            workspaceRootRelativePath: '',
            inputPromptRelativePath: '',
            outputPromptRelativePath: '',
            agentWorkspaceRelativePath: '',
            pipelineStep: '',
            opencodeRunId: '',
            filesInitializedAtUtc: null,
            createdAtUtc: now,
            updatedAtUtc: now,
        });

        const paths = agentOpencodeWorkspacePaths({
            threadId: String(threadObjectId),
        });

        const chatMessage = await ModelChatLlm.create({
            type: 'text',
            content: AGENT_OPENCODE_STARTED_MESSAGE,
            userId: String(userId),
            threadId: threadObjectId,
            isAi: true,
            tags: [AGENT_OPENCODE_CHAT_TAG],
            aiModelProvider: thread.aiModelProvider || '',
            aiModelName: thread.aiModelName || '',
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });

        await ModelAgentOpencodeInstance.findByIdAndUpdate(instance._id, {
            $set: {
                chatMessageId: chatMessage._id,
                workspaceRootRelativePath: paths.root,
                inputPromptRelativePath: paths.inputPrompt,
                outputPromptRelativePath: paths.outputPrompt,
                agentWorkspaceRelativePath: paths.agentWorkspaceDir,
                updatedAtUtc: new Date(),
            },
        });

        // Create empty session first (as you asked) so frontend can show session id immediately,
        // then pipeline will reuse it when posting the real message.
        // We must write opencode.json before creating the session, otherwise the session
        // has no provider and the next POST /session/{id}/message will fail with UnknownError.
        let createdSessionId: string | null = null;
        try {
            const threadRec = thread as unknown as Record<string, unknown>;
            const existingFromThread = typeof threadRec.opencodeSessionId === 'string'
                ? String(threadRec.opencodeSessionId).trim()
                : '';
            const hasExisting = isOpencodeSessionId(existingFromThread);
            if (!hasExisting) {
                const userApiKey = await ModelUserApiKey.findOne({ userId });
                const apiKeys = getApiKeyByObject(userApiKey);
                const shell = getAgentOpencodeShellConfig(apiKeys);
                if (shell) {
                    // Need at least one LLM provider to create a usable session
                    const { hasAgentOpencodeLlmProvider, writeAgentOpencodeSettingsFiles } = await import('./pipeline/agentOpencodeSettings');
                    if (!hasAgentOpencodeLlmProvider(apiKeys)) {
                        console.warn('agentOpencodeInitiate: no LLM provider, skip empty session create');
                    } else {
                        // Write minimal opencode.json + .env so the session has a provider
                        const chatMessageIdForSettings = String(chatMessage._id);
                        try {
                            await writeAgentOpencodeSettingsFiles({
                                shell,
                                paths,
                                apiKeys,
                                userId: String(userId),
                                chatMessageId: chatMessageIdForSettings,
                                mcpEnabled: true,
                                threadProviderId: typeof threadRec.aiModelProvider === 'string' ? String(threadRec.aiModelProvider) : '',
                                threadModelName: typeof threadRec.aiModelName === 'string' ? String(threadRec.aiModelName) : '',
                            });
                        } catch (e) {
                            console.warn('agentOpencodeInitiate: write settings before session failed', e instanceof Error ? e.message : String(e));
                        }
                        const titleRaw = typeof threadRec.threadTitle === 'string'
                            ? String(threadRec.threadTitle).trim()
                            : String(threadObjectId);
                        const sessionTitle = `AI Notes ${titleRaw}`.slice(0, 80);
                        const containerDir = opencodeContainerDirectory(paths.agentWorkspaceDir);
                        const created = await opencodeCreateSessionViaShell({
                            shell,
                            directory: containerDir,
                            title: sessionTitle,
                            timeoutMs: 15_000,
                        });
                        if (isOpencodeSessionId(created.sessionId)) {
                            createdSessionId = created.sessionId;
                            const now2 = new Date();
                            await ModelChatLlmThread.findByIdAndUpdate(threadObjectId, {
                                $set: { opencodeSessionId: createdSessionId, updatedAtUtc: now2 },
                            });
                            await ModelAgentOpencodeInstance.findByIdAndUpdate(instance._id, {
                                $set: { opencodeRunId: createdSessionId, updatedAtUtc: now2 },
                            });
                        }
                    }
                }
            } else {
                createdSessionId = existingFromThread;
                await ModelAgentOpencodeInstance.findByIdAndUpdate(instance._id, {
                    $set: { opencodeRunId: createdSessionId, updatedAtUtc: new Date() },
                });
            }
        } catch (e) {
            console.warn(`agentOpencodeInitiate: create empty session failed (pipeline will create):`, e instanceof Error ? e.message : String(e));
        }

        return {
            success: true,
            errorReason: '',
            agentOpencodeInstanceId: String(instance._id),
            opencodeSessionId: createdSessionId,
        };
    } catch (error) {
        console.error(`agentOpencodeInitiate (${messageId}):`, error);
        return {
            success: false,
            errorReason: error instanceof Error ? error.message : 'Internal server error',
            agentOpencodeInstanceId: null,
            opencodeSessionId: null,
        };
    }
};

export default agentOpencodeInitiate;
