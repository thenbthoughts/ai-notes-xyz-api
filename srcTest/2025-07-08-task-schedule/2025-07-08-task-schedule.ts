import mongoose from "mongoose";
import { ModelUserApiKey } from "../../src/schema/SchemaUserApiKey.schema";
import envKeys from "../../src/config/envKeys";
import { llmPendingTaskTypes } from "../../src/utils/llmPendingTask/llmPendingTaskConstants";
import { ModelLlmPendingTaskCron } from "../../src/schema/SchemaLlmPendingTaskCron.schema";
import llmPendingTaskProcessFunc from "../../src/utils/llmPendingTask/llmPendingTaskProcessFunc";

const init = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);

        const auth_username = 'example';
        const taskScheduleId = new mongoose.Types.ObjectId('6894d7ee432f43bef7e342c8');
        
        const apiKey = await ModelUserApiKey.findOne({
            username: auth_username,
        });

        if (!apiKey) {
            throw new Error('Api key not found');
        }

        const resultInsert = await ModelLlmPendingTaskCron.create({
            username: auth_username,
            taskType: llmPendingTaskTypes.page.taskSchedule.taskSchedule_suggestDailyTasksByAi,
            targetRecordId: taskScheduleId,
        });

        const resultInsert_id = resultInsert._id as string;
        const result = await llmPendingTaskProcessFunc({
            _id: mongoose.Types.ObjectId.createFromHexString(
                resultInsert_id.toString()
            ),
        })

        mongoose.disconnect();
    } catch (error) {
        console.error(error);
    }
}

init();

// npx ts-node -r dotenv/config ./srcTest/2025-07-08-task-schedule/2025-07-08-task-schedule.ts