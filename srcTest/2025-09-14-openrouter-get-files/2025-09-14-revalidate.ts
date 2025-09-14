import axios from "axios";
import { ModelUserApiKey } from "../../src/schema/schemaUser/SchemaUserApiKey.schema";
import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";
import { ModelLlmPendingTaskCron } from "../../src/schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema";
import { llmPendingTaskTypes } from "../../src/utils/llmPendingTask/llmPendingTaskConstants";
import llmPendingTaskProcessFunc from "../../src/utils/llmPendingTask/llmPendingTaskProcessFunc";

const revalidate = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);

        const userApiKey = await ModelUserApiKey.findOne({
            username: 'exampleuser',
        });

        if (!userApiKey) {
            throw new Error('User API key not found');
        }

        const task = await ModelLlmPendingTaskCron.create({
            taskType: llmPendingTaskTypes.page.settings.openRouterModelGet,
            username: 'exampleuser',
        });

        await llmPendingTaskProcessFunc({
            _id: task._id as mongoose.Types.ObjectId,
        })

        console.timeEnd('total-time');
        mongoose.disconnect();
    } catch (error) {
        console.error(error);
    }
}

revalidate();

// npx ts-node srcTest/2025-09-14-openrouter-get-files/2025-09-14-revalidate.ts
// npx ts-node -r dotenv/config ./srcTest/2025-09-14-openrouter-get-files/2025-09-14-revalidate.ts