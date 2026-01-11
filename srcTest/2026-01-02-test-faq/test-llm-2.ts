import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";

import { ModelLlmPendingTaskCron } from "../../src/schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema";
import { llmPendingTaskTypes } from "../../src/utils/llmPendingTask/llmPendingTaskConstants";
import llmPendingTaskProcessFunc from "../../src/utils/llmPendingTask/llmPendingTaskProcessFunc";

const init = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);

        const resultInsert = await ModelLlmPendingTaskCron.create({
            "username": "gridfstest",
            "taskType": llmPendingTaskTypes.page.featureAiActions.task,
            "targetRecordId": "6963ae9ce6c8989223a95da4",
        });

        console.log('resultInsert', resultInsert);

        const resultInsert_id = resultInsert._id as string;
        const result = await llmPendingTaskProcessFunc({
            _id: mongoose.Types.ObjectId.createFromHexString(resultInsert_id.toString()),
        })
        console.log('result: ', result);

        console.timeEnd('total-time');
        await mongoose.disconnect();
    } catch (error) {
        console.error('Error in test:', error);
        await mongoose.disconnect();
    }
}

init();

// npx ts-node -r dotenv/config ./srcTest/2026-01-02-test-faq/test-llm-2.ts