import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";
import { llmPendingTaskTypes } from "../../src/utils/llmPendingTask/llmPendingTaskConstants";
import { ModelLlmPendingTaskCron } from "../../src/schema/SchemaLlmPendingTaskCron.schema";
import llmPendingTaskProcessFunc from "../../src/utils/llmPendingTask/llmPendingTaskProcessFunc";
import { ModelUser } from "../../src/schema/SchemaUser.schema";
import IUser from "../../src/types/typesSchema/SchemaUser.types";

const init = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);

        const auth_username = 'example';
        
        const userRecord = await ModelUser.findOne({
            username: auth_username,
        }) as IUser;

        if (!userRecord) {
            throw new Error('User not found');
        }
        
        const userId = userRecord._id;

        const resultInsert = await ModelLlmPendingTaskCron.create({
            username: auth_username,
            taskType: llmPendingTaskTypes.page.taskSchedule.taskSchedule_generateDailySummaryByUserId,
            targetRecordId: userId,
        });

        const resultInsert_id = resultInsert._id as string;
        const result = await llmPendingTaskProcessFunc({
            _id: mongoose.Types.ObjectId.createFromHexString(
                resultInsert_id.toString()
            ),
        })

        await mongoose.disconnect();
    } catch (error) {
        console.error(error);
    }
}

init();

// npx ts-node -r dotenv/config ./srcTest/2025-07-15-daily-summary/2025-07-15-daily-summary.ts