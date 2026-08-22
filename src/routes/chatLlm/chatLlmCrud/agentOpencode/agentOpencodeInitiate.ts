import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAgentOpencodeInstance } from '../../../../schema/schemaChatLlm/SchemaAgentOpencode/SchemaAgentOpencodeInstance.schema';
import {
    ANSWER_ENGINE_AGENT_OPENCODE,
    AGENT_OPENCODE_CHAT_TAG,
    AGENT_OPENCODE_STARTED_MESSAGE,
} from './agentOpencodeConstants';
import { agentOpencodeWorkspacePaths } from './agentOpencodeWorkspace';

const agentOpencodeInitiate = async ({
    messageId,
}: {
    messageId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    errorReason: string;
    agentOpencodeInstanceId: string | null;
}> => {
    try {
        const message = await ModelChatLlm.findById(messageId);
        if (!message) {
            return { success: false, errorReason: 'Message not found', agentOpencodeInstanceId: null };
        }

        const thread = await ModelChatLlmThread.findById(message.threadId);
        if (!thread) {
            return { success: false, errorReason: 'Thread not found', agentOpencodeInstanceId: null };
        }

        if (thread.answerEngine !== ANSWER_ENGINE_AGENT_OPENCODE) {
            return {
                success: false,
                errorReason: 'Thread is not configured for Agent (Opencode)',
                agentOpencodeInstanceId: null,
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
            instanceId: String(instance._id),
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

        return {
            success: true,
            errorReason: '',
            agentOpencodeInstanceId: String(instance._id),
        };
    } catch (error) {
        console.error(`agentOpencodeInitiate (${messageId}):`, error);
        return {
            success: false,
            errorReason: error instanceof Error ? error.message : 'Internal server error',
            agentOpencodeInstanceId: null,
        };
    }
};

export default agentOpencodeInitiate;
