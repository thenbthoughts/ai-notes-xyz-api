import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";

import { ModelLlmPendingTaskCron } from "../../src/schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema";
import { llmPendingTaskTypes } from "../../src/utils/llmPendingTask/llmPendingTaskConstants";
import llmPendingTaskProcessFunc from "../../src/utils/llmPendingTask/llmPendingTaskProcessFunc";
import getNextMessageFromLast30Conversation from "../../src/routes/chatLlm/chatLlmCrud/utils/getNextMessageFromLast25Conversation";
import { ModelChatLlmThread } from "../../src/schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelUserApiKey } from "../../src/schema/schemaUser/SchemaUserApiKey.schema";
import { IChatLlmThread } from "../../src/types/typesSchema/typesChatLlm/SchemaChatLlmThread.types";
import { ModelChatLlm } from "../../src/schema/schemaChatLlm/SchemaChatLlm.schema";
import { IChatLlm } from "../../src/types/typesSchema/typesChatLlm/SchemaChatLlm.types";

const init = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);

        const threadInfo = await ModelChatLlmThread.findOne({
            _id: mongoose.Types.ObjectId.createFromHexString("6966799e30832d58c112a451"),
            username: "gridfstest",
        }) as IChatLlmThread;

        const userApiKey = await ModelUserApiKey.findOne({
            username: "gridfstest",
        });

        if (!threadInfo || !userApiKey) {
            throw new Error('Thread info or user API key not found');
        }

        const resultFromLastConversation = await ModelChatLlm.create({
            type: 'text',
            content: 'AI generating in progress...',
            username: "gridfstest",
            tags: [],
            fileUrl: '',
            fileUrlArr: '',
            threadId: threadInfo._id,
            isAi: true,
            // aiModelProvider: "ollama",
            // aiModelName: "qwen3-vl:2b",
            aiModelProvider: "ollama",
            aiModelName: "ollama run ministral-3:8b",

            createdAtUtc: new Date(),
            createdAtIpAddress: '127.0.0.1',
            createdAtUserAgent: 'test',
            updatedAtUtc: new Date(),
            updatedAtIpAddress: '127.0.0.1',
            updatedAtUserAgent: 'test',
        }) as IChatLlm;

        const messageId = resultFromLastConversation._id as mongoose.Types.ObjectId;

        const result = await getNextMessageFromLast30Conversation({
            threadId: threadInfo._id as mongoose.Types.ObjectId,
            threadInfo,
            username: "gridfstest",
            aiModelProvider: "ollama",
            aiModelName: "qwen3-vl:2b",
            userApiKey: userApiKey,
            messageId: messageId as unknown as mongoose.Types.ObjectId,
        });

        console.log('result:', result);

        console.timeEnd('total-time');
        await mongoose.disconnect();
    } catch (error) {
        console.error('Error in test:', error);
        await mongoose.disconnect();
    }
}

init();

// npx ts-node -r dotenv/config ./srcTest/2026-01-02-test-faq/test-llm-3.ts