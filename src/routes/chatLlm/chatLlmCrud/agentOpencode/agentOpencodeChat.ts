import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentOpencodeInstance } from '../../../../schema/schemaChatLlm/SchemaAgentOpencode/SchemaAgentOpencodeInstance.schema';
import { AGENT_OPENCODE_CHAT_TAG, AGENT_OPENCODE_STARTED_MESSAGE } from './agentOpencodeConstants';
import type { IAgentOpencodeInstance } from '../../../../types/typesSchema/typesChatLlm/typesAgentOpencode/SchemaAgentOpencodeInstance.types';

export const syncAgentOpencodeChatMessage = async ({
    instance,
    content,
}: {
    instance: IAgentOpencodeInstance;
    content: string;
}): Promise<void> => {
    const nextContent = content.trim() ? content.replace(/\s+$/, '') : AGENT_OPENCODE_STARTED_MESSAGE;
    if (instance.chatMessageId) {
        await ModelChatLlm.findByIdAndUpdate(instance.chatMessageId, {
            $set: {
                content: nextContent,
                updatedAtUtc: new Date(),
            },
        });
        return;
    }

    await ModelChatLlm.create({
        type: 'text',
        content: nextContent,
        userId: String(instance.userId),
        threadId: instance.threadId,
        isAi: true,
        tags: [AGENT_OPENCODE_CHAT_TAG],
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });
};

export const failAgentOpencodeInstance = async ({
    instance,
    errorReason,
}: {
    instance: IAgentOpencodeInstance;
    errorReason: string;
}): Promise<void> => {
    const now = new Date();
    await ModelAgentOpencodeInstance.findByIdAndUpdate(instance._id, {
        $set: {
            status: 'failed',
            statusIsRunning: false,
            errorReason,
            updatedAtUtc: now,
        },
    });

    try {
        await syncAgentOpencodeChatMessage({
            instance,
            content: `Agent (Opencode) failed.\n\n${errorReason}`,
        });
    } catch (err) {
        console.error('failAgentOpencodeInstance chat update failed:', err);
    }
};
