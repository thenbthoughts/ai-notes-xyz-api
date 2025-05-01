import mongoose from "mongoose";
import { ModelLlmPendingTaskCron } from "../../schema/SchemaLlmPendingTaskCron.schema";
import { llmPendingTaskTypes } from "./llmPendingTaskConstants";
import generateChatThreadTitleById from "./page/chat/generateChatThreadTitleById";

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

        if(resultTask.taskType === llmPendingTaskTypes.page.chat.generateChatThreadTitleById) {
            isTaskDone = await generateChatThreadTitleById({
                targetRecordId: resultTask.targetRecordId,
            });
        }

        // update task info
        if(isTaskDone === true) {
            resultTask.taskStatus = 'success';
        } else {
            resultTask.taskRetryCount += 1;
        }
        if(resultTask.taskRetryCount >= 3) {
            resultTask.taskStatus = 'failed';
        }
        const dateTimeEnd = new Date().valueOf();
        console.log(dateTimeEnd-dateTimeStart);
        resultTask.taskTimeTakenInMills = dateTimeEnd-dateTimeStart;
        await resultTask.save();

        return isTaskDone;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default llmPendingTaskProcessFunc;