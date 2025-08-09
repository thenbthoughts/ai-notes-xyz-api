import { DateTime } from 'luxon';

import { ModelTask } from "../../../../schema/schemaTask/SchemaTask.schema";
import { ModelTaskSchedule } from '../../../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import { ModelUser } from '../../../../schema/SchemaUser.schema';

import { tsTaskListSchedule } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';
import { tsTaskListScheduleAddTask } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListScheduleAddTask.types';

import { funcSendMail } from '../../../files/funcSendMail';
import { ModelTaskScheduleAddTask } from '../../../../schema/schemaTaskSchedule/SchemaTaskScheduleTaskAdd.schema';
import { ModelTaskWorkspace } from '../../../../schema/schemaTask/SchemaTaskWorkspace.schema';
import { ModelTaskStatusList } from '../../../../schema/schemaTask/SchemaTaskStatusList.schema';

const taskScheduleAddTask = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // Step 1: Find and validate task record
        const taskInfo = await ModelTaskSchedule.findOne({
            _id: targetRecordId,
        }) as tsTaskListSchedule;
        if (!taskInfo) {
            return true;
        }

        // step 2: get task add
        const taskAddObj = await ModelTaskScheduleAddTask.findOne({
            taskScheduleId: taskInfo._id,
        }) as tsTaskListScheduleAddTask;
        if (!taskAddObj) {
            return true;
        }

        // step 3: get task workspace
        const taskWorkspaceObj = await ModelTaskWorkspace.findOne({
            _id: taskAddObj.taskWorkspaceId,
            username: taskInfo.username,
        }) as tsTaskListSchedule;
        if (!taskWorkspaceObj) {
            return true;
        }

        // step 4: get task status
        const taskStatusObj = await ModelTaskStatusList.findOne({
            _id: taskAddObj.taskStatusId,
            username: taskInfo.username,
        }) as tsTaskListSchedule;
        if (!taskStatusObj) {
            return true;
        }

        let taskTitle = taskAddObj.taskTitle;
        if(taskAddObj.taskDatePrefix) {
            const currentDateInUserTz = DateTime.now().setZone(taskInfo.timezoneName);
            const dateStr = currentDateInUserTz.toFormat('yyyy-MM-dd');
            taskTitle = `${dateStr} - ${taskTitle}`;
        }

        // insert task
        const taskInsert = await ModelTask.create({
            username: taskInfo.username,
            taskWorkspaceId: taskWorkspaceObj?._id || null,
            taskStatusId: taskStatusObj?._id || null,
            title: taskTitle,
            description: taskAddObj.taskAiContext,

            isCompleted: false,
            isArchived: false,
            isTaskPinned: false,
            priority: 'very-low',
            dueDate: null,
            labels: [],
        });

        // create a mail
        const userInfo = await ModelUser.findOne({
            username: taskInfo.username,
        });
        if (!userInfo) {
            return true;
        }

        // generate mail content
        const mailContent = `
        <h1>Task schedule - ${taskTitle}</h1>
        <p>${taskAddObj.taskAiContext}</p>
        <p>Task ID: ${taskInsert._id}</p>
        <p>Task Workspace: ${taskWorkspaceObj.title}</p>
        <p>Task Status: ${taskStatusObj.title}</p>
        <p><a href="https://demo.ai-notes.xyz/user/task?workspace=${taskWorkspaceObj._id}&edit-task-id=${taskInsert._id}">View Task in Workspace</a></p>
        `;

        // send mail
        await funcSendMail({
            username: taskInfo.username,
            smtpTo: userInfo.email,
            subject: `Task schedule - ${taskTitle} | AI Notes XYZ`,
            text: '',
            html: mailContent,
        });

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default taskScheduleAddTask;