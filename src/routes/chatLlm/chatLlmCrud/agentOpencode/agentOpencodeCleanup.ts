import mongoose from 'mongoose';

import { ModelAgentOpencodeInstance } from '../../../../schema/schemaChatLlm/SchemaAgentOpencode/SchemaAgentOpencodeInstance.schema';
import type { tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';
import {
    agentOpencodeDeleteThreadRoot,
    getAgentOpencodeShellConfig,
} from './agentOpencodeWorkspace';

const cleanupAgentOpencodeForThread = async ({
    threadId,
    userId,
    apiKey,
}: {
    threadId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId | string;
    apiKey: tsUserApiKey;
}): Promise<void> => {
    const userObjectId =
        typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    await ModelAgentOpencodeInstance.deleteMany({
        threadId,
        userId: userObjectId,
    });

    const shell = getAgentOpencodeShellConfig(apiKey);
    if (!shell) {
        return;
    }

    try {
        const result = await agentOpencodeDeleteThreadRoot({
            shell,
            threadId: String(threadId),
        });
        if (!result.ok) {
            console.warn('[cleanupAgentOpencodeForThread] folder delete:', result.error);
        }
    } catch (err) {
        console.warn('[cleanupAgentOpencodeForThread] folder delete error:', err);
    }
};

export default cleanupAgentOpencodeForThread;
