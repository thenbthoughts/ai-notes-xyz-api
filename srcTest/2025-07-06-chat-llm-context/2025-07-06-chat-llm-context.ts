import mongoose from "mongoose";
import suggestAutoContextNotesByThreadId from "../../src/routes/chatLlm/chatLlmThreads/utils/selectAutoContextNotesByThreadId";
import { ModelUserApiKey } from "../../src/schema/schemaUser/SchemaUserApiKey.schema";
import envKeys from "../../src/config/envKeys";

const init = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);
        
        const apiKey = await ModelUserApiKey.findOne({
            username: 'example',
        });

        if (!apiKey) {
            throw new Error('Api key not found');
        }

        const threadId = new mongoose.Types.ObjectId('686a890c455b2f22b8eb1378');
        const username = 'example';
        const llmAuthToken = apiKey?.apiKeyOpenrouter;
        const provider = 'openrouter';

        console.time('suggestAutoContextNotesByThreadId');
        const result = await suggestAutoContextNotesByThreadId({
            threadId,
            username,
            llmAuthToken,
            provider,
        });
        console.timeEnd('suggestAutoContextNotesByThreadId');

        console.log(result);
        console.timeEnd('total-time');

        mongoose.disconnect();
    } catch (error) {
        console.error(error);
    }
}

init();

// npx ts-node -r dotenv/config ./srcTest/2025-07-06-chat-llm-context/2025-07-06-chat-llm-context.ts