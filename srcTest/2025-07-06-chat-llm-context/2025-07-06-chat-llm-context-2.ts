import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";
import { ModelLlmPendingTaskCron } from "../../src/schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema";
import { llmPendingTaskTypes } from "../../src/utils/llmPendingTask/llmPendingTaskConstants";
import llmPendingTaskProcessFunc from "../../src/utils/llmPendingTask/llmPendingTaskProcessFunc";

const init = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);
        
        const llmPendingTask = await ModelLlmPendingTaskCron.create({
            taskType: llmPendingTaskTypes.page.settings.groqModelGet,
            username: 'example',

            createdAtUtc: new Date(),
        });

        const result = await llmPendingTaskProcessFunc({
            _id: llmPendingTask._id as mongoose.Types.ObjectId,
        })
        console.log(result);

        console.timeEnd('total-time');

        mongoose.disconnect();
    } catch (error) {
        console.error(error);
    }
}

init();

// npx ts-node -r dotenv/config ./srcTest/2025-07-06-chat-llm-context/2025-07-06-chat-llm-context-2.ts