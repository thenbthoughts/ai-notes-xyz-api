import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";
import { ModelLlmPendingTaskCron } from "../../src/schema/SchemaLlmPendingTaskCron.schema";
import llmPendingTaskProcessFunc from "../../src/utils/llmPendingTask/llmPendingTaskProcessFunc";

// Example usage
const init = async () => {
    console.time('mongoose-connect');
    await mongoose.connect(envKeys.MONGODB_URI);
    console.timeEnd('mongoose-connect');

    const resultInsert = await ModelLlmPendingTaskCron.create({
        "username": "example",
        "taskType": "pageChat_generateChatThreadTitleById",
        "targetRecordId": "6813386d3215f6833cc84d19",
        "aiModelName": "meta-llama/llama-4-scout-17b-16e-instruct",
        "aiModelProvider": "groq",
    });

    console.time('total-time');
    const resultInsert_id = resultInsert._id as string;
    const result = await llmPendingTaskProcessFunc({
        _id: mongoose.Types.ObjectId.createFromHexString( resultInsert_id.toString()),
    })
    console.log('result: ', result);
    console.timeEnd('total-time');

    mongoose.disconnect();
}

init();

// npx ts-node -r dotenv/config ./srcTest/2025-04-30-test-llm-pending-task/2025-04-30-test-llm-pending-task.ts