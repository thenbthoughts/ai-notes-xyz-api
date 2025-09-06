import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";
import { llmPendingTaskTypes } from "../../src/utils/llmPendingTask/llmPendingTaskConstants";
import { ModelLlmPendingTaskCron } from "../../src/schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema";
import llmPendingTaskProcessFunc from "../../src/utils/llmPendingTask/llmPendingTaskProcessFunc";
import { ModelUser } from "../../src/schema/schemaUser/SchemaUser.schema";
import IUser from "../../src/types/typesSchema/typesUser/SchemaUser.types";
import { generateDailySummaryByUserId } from "../../src/utils/llmPendingTask/page/taskSchedule/timeBasedSummary/generateDailySummaryByUserId";

const init = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);

        const auth_username = 'nibf';
        
        const userRecord = await ModelUser.findOne({
            username: auth_username,
        }) as IUser;

        if (!userRecord) {
            throw new Error('User not found');
        }
        
        const resultInsert = await ModelLlmPendingTaskCron.create({
            username: auth_username,
            taskType: llmPendingTaskTypes.page.taskSchedule.taskSchedule_generateDailySummaryByUserId,
            targetRecordId: '68a017bbc9283b4666a56fac',
        });

        const resultInsert_id = resultInsert._id as string;
        const result = await llmPendingTaskProcessFunc({
            _id: mongoose.Types.ObjectId.createFromHexString(
                resultInsert_id.toString()
            ),
        })

        const result2 = await generateDailySummaryByUserId({
            username: 'nibf',
            summaryDate: new Date('2025-08-16T00:00:00.000Z'),
        });

        for (let index = 0; index < 60; index++) {
            const date = new Date('2025-08-16T00:00:00.000Z');

            const substractDays = index * 1;
            date.setDate(date.getDate() - substractDays);

            const result2 = await generateDailySummaryByUserId({
                username: 'nibf',
                summaryDate: date,
            });
        }

        await mongoose.disconnect();
    } catch (error) {
        console.error(error);
    }
}

init();

// npx ts-node -r dotenv/config ./srcTest/2025-07-15-daily-summary/2025-07-15-daily-summary.ts