import mongoose from "mongoose";

// Schema
import { ModelLlmPendingTaskCron } from "../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema";
import { llmPendingTaskTypes } from "./llmPendingTaskConstants";


// Settings tasks
import openRouterModelGet from "./page/settings/openRouterModelGet";
import groqModelGet from "./page/settings/groqModelGet";

// Task Schedule tasks
import suggestDailyTasksByAi from "./page/taskSchedule/suggestDailyTasksByAi";
import taskScheduleAddTask from "./page/taskSchedule/taskScheduleAddTask";
import sendMyselfEmail from "./page/taskSchedule/sendMyselfEmail";

// Notes time based summary
import executeDailySummaryByUserId from "./page/taskSchedule/timeBasedSummary/generateDailySummaryByUserId";
import executeWeeklySummaryByUserId from "./page/taskSchedule/timeBasedSummary/generateWeeklySummaryByUserId";
import executeMonthlySummaryByUserId from "./page/taskSchedule/timeBasedSummary/generateMonthlySummaryByUserId";

// LlmContext tasks
import generateKeywordsBySourceId from "./page/featureAiAction/featureAiActionAll/keyword/generateKeywordsBySourceId";

// Feature AI Actions tasks
import featureAiActionNotesInit from "./page/featureAiAction/featureAiActionNotes/featureAiActionNotesInit";
import featureAiActionTaskInit from "./page/featureAiAction/featureAiActionTask/featureAiActionTaskInit";
import featureAiActionLifeEventsInit from "./page/featureAiAction/featureAiActionLifeEvents/featureAiActionLifeEventsInit";
import featureAiActionInfoVaultInit from "./page/featureAiAction/featureAiActionInfoVault/featureAiActionInfoVaultInit";
import featureAiActionChatThreadInit from "./page/featureAiAction/featureAiActionChatThread/featureAiActionChatThreadInit";
import featureAiActionChatMessageInit from "./page/featureAiAction/featureAiActionChatMessage/featureAiActionChatMessageInit";

const llmPendingTaskProcessFunc = async ({
    _id,
}: {
    _id: mongoose.mongo.BSON.ObjectId
}) => {
    try {
        const dateTimeStart = new Date().valueOf();
        let isTaskDone = false;

        console.log('_id: ', _id);

        const resultTask = await ModelLlmPendingTaskCron.findOne({
            _id: _id,
            taskStatus: {
                $ne: 'done'
            },
        });

        if (!resultTask) {
            throw new Error('Task not found');
        }

        // TODO is task lock
        let isTaskLock = false;

        switch (resultTask.taskType) {
            // Task Schedule tasks
            case llmPendingTaskTypes.page.taskSchedule.taskSchedule_generateDailySummaryByUserId:
                try {
                    // daily summary
                    isTaskDone = await executeDailySummaryByUserId({
                        targetRecordId: resultTask.targetRecordId,
                    });
                    // weekly summary
                    isTaskDone = await executeWeeklySummaryByUserId({
                        targetRecordId: resultTask.targetRecordId,
                    });
                    // monthly summary
                    isTaskDone = await executeMonthlySummaryByUserId({
                        targetRecordId: resultTask.targetRecordId,
                    });
                } catch (error) {
                    console.error(error);
                }
                break;


            // Settings tasks
            case llmPendingTaskTypes.page.settings.openRouterModelGet:
                isTaskDone = await openRouterModelGet();
                break;
            
            case llmPendingTaskTypes.page.settings.groqModelGet:
                isTaskDone = await groqModelGet({
                    username: resultTask.username,
                });
                break;

            // Task Schedule tasks
            case llmPendingTaskTypes.page.taskSchedule.taskSchedule_suggestDailyTasksByAi:
                isTaskDone = await suggestDailyTasksByAi({
                    targetRecordId: resultTask.targetRecordId,
                });
                break;

            case llmPendingTaskTypes.page.taskSchedule.taskSchedule_taskAdd:
                isTaskDone = await taskScheduleAddTask({
                    targetRecordId: resultTask.targetRecordId,
                });
                break;

            case llmPendingTaskTypes.page.taskSchedule.taskSchedule_sendMyselfEmail:
                isTaskDone = await sendMyselfEmail({
                    targetRecordId: resultTask.targetRecordId,
                });
                break;

            // LlmContext tasks
            case llmPendingTaskTypes.page.llmContext.generateKeywordsBySourceId:
                isTaskDone = await generateKeywordsBySourceId({
                    targetRecordId: resultTask.targetRecordId,
                });
                break;

            // Feature AI Actions tasks
            case llmPendingTaskTypes.page.featureAiActions.notes:
                isTaskDone = await featureAiActionNotesInit({
                    targetRecordId: resultTask.targetRecordId,
                });
                break;

            case llmPendingTaskTypes.page.featureAiActions.task:
                isTaskDone = await featureAiActionTaskInit({
                    targetRecordId: resultTask.targetRecordId,
                });
                break;

            case llmPendingTaskTypes.page.featureAiActions.lifeEvents:
                isTaskDone = await featureAiActionLifeEventsInit({
                    targetRecordId: resultTask.targetRecordId,
                });
                break;

            case llmPendingTaskTypes.page.featureAiActions.infoVault:
                isTaskDone = await featureAiActionInfoVaultInit({
                    targetRecordId: resultTask.targetRecordId,
                });
                break;

            case llmPendingTaskTypes.page.featureAiActions.chatThread:
                isTaskDone = await featureAiActionChatThreadInit({
                    targetRecordId: resultTask.targetRecordId,
                });
                break;

            case llmPendingTaskTypes.page.featureAiActions.chatMessage:
                isTaskDone = await featureAiActionChatMessageInit({
                    targetRecordId: resultTask.targetRecordId,
                });
                break;

            default:
                console.warn('Unknown task type:', resultTask.taskType);
                break;
        }

        // update task info
        if (isTaskDone === true) {
            resultTask.taskStatus = 'success';
        } else {
            resultTask.taskRetryCount += 1;
        }
        if (resultTask.taskRetryCount >= 3) {
            resultTask.taskStatus = 'failed';
        }
        const dateTimeEnd = new Date().valueOf();
        console.log(dateTimeEnd - dateTimeStart);
        resultTask.taskTimeTakenInMills = dateTimeEnd - dateTimeStart;
        await resultTask.save();

        return isTaskDone;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default llmPendingTaskProcessFunc;