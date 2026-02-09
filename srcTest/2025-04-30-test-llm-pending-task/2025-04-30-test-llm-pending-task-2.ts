import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";
import { ModelLlmPendingTaskCron } from "../../src/schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema";
import llmPendingTaskProcessFunc from "../../src/utils/llmPendingTask/llmPendingTaskProcessFunc";
import { llmPendingTaskTypes } from "../../src/utils/llmPendingTask/llmPendingTaskConstants";

// Example usage
const init = async () => {
    console.time('mongoose-connect');
    await mongoose.connect(envKeys.MONGODB_URI);
    console.timeEnd('mongoose-connect');

    const resultInsert = await ModelLlmPendingTaskCron.create({
        "username": "example",
        "taskType": llmPendingTaskTypes.page.featureAiActions.chatThread,
        "targetRecordId": "68e2b9f0b5a33b7965cd6324",
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