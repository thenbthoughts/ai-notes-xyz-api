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
        "taskType": "pageChat_generateChatTagsById",
        "targetRecordId": "681345543e4cbd8e1707125f",
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

// npx ts-node -r dotenv/config ./srcTest/2025-04-30-test-llm-pending-task/2025-04-30-test-llm-pending-task-2.ts