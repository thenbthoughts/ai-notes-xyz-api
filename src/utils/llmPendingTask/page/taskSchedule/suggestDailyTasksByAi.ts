import { DateTime } from 'luxon';
import { PipelineStage } from 'mongoose';

import { ModelTask } from "../../../../schema/schemaTask/SchemaTask.schema";
import { ModelTaskSchedule } from '../../../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import { ModelUser } from '../../../../schema/SchemaUser.schema';
import { ModelUserApiKey } from "../../../../schema/SchemaUserApiKey.schema";

import { tsTaskListSchedule } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';

import { funcSendMail } from '../../../files/funcSendMail';

const getTaskList = async ({
    auth_username,
}: {
    auth_username: string;
}) => {
    try {
        let tempStage = {} as PipelineStage;
        const stateDocument = [] as PipelineStage[];

        // auth
        tempStage = {
            $match: {
                username: auth_username,
            }
        }
        stateDocument.push(tempStage);

        // stateDocument -> match
        tempStage = {
            $match: {
                isCompleted: false,
                isArchived: false,
            }
        }
        stateDocument.push(tempStage);

        // stageDocument -> add field
        const currentDate = new Date();
        tempStage = {
            $addFields: {
                // Calculate relevance score for initial filtering
                relevanceScore: {
                    $add: [
                        // Is pinned
                        {
                            $cond: {
                                if: { $eq: ['$isTaskPinned', true] },
                                then: 10000,
                                else: 0
                            }
                        },
                        // Priority scoring
                        {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$priority', 'very-high'] }, then: 25 },
                                    { case: { $eq: ['$priority', 'high'] }, then: 20 },
                                    { case: { $eq: ['$priority', 'medium'] }, then: 15 },
                                    { case: { $eq: ['$priority', 'low'] }, then: 10 },
                                    { case: { $eq: ['$priority', 'very-low'] }, then: 5 },
                                ],
                                default: 0
                            }
                        },
                        // Due date urgency
                        {
                            $cond: {
                                if: { $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', currentDate] }] },
                                then: 30, // Overdue
                                else: {
                                    $cond: {
                                        if: { $and: [{ $ne: ['$dueDate', null] }, { $lte: ['$dueDate', new Date(currentDate.getTime() + 3 * 24 * 60 * 60 * 1000)] }] },
                                        then: 20, // Due in 3 days
                                        else: {
                                            $cond: {
                                                if: { $and: [{ $ne: ['$dueDate', null] }, { $lte: ['$dueDate', new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000)] }] },
                                                then: 15, // Due in 7 days
                                                else: 0
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        // Recency bonus
                        {
                            $cond: {
                                if: { $gte: ['$updatedAtUtc', new Date(currentDate.getTime() - 3 * 24 * 60 * 60 * 1000)] },
                                then: 10, // Updated in last 3 days
                                else: {
                                    $cond: {
                                        if: { $gte: ['$updatedAtUtc', new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000)] },
                                        then: 5, // Updated in last 7 days
                                        else: 0
                                    }
                                }
                            }
                        },
                    ]
                }
            }
        }
        stateDocument.push(tempStage);

        // stateDocument -> sort
        tempStage = {
            $sort: {
                relevanceScore: -1,
            }
        }
        stateDocument.push(tempStage);

        // limit -> 10
        tempStage = {
            $limit: 10,
        }
        stateDocument.push(tempStage);

        // stateDocument -> lookup task status list
        tempStage = {
            $lookup: {
                from: 'taskStatusList',
                let: {
                    let_taskStatusId: '$taskStatusId',
                    let_taskWorkspaceId: '$taskWorkspaceId',
                },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    {
                                        $eq: ['$username', auth_username]
                                    },
                                    {
                                        $eq: ['$_id', '$$let_taskStatusId']
                                    },
                                    {
                                        $eq: ['$taskWorkspaceId', '$$let_taskWorkspaceId']
                                    }
                                ]
                            }
                        }
                    }
                ],
                as: 'taskStatusList',
            }
        }
        stateDocument.push(tempStage);

        // stateDocument -> lookup task workspace
        tempStage = {
            $lookup: {
                from: 'taskWorkspace',
                localField: 'taskWorkspaceId',
                foreignField: '_id',
                as: 'taskWorkspace',
            }
        }
        stateDocument.push(tempStage);

        // stateDocument -> sub task
        tempStage = {
            $lookup: {
                from: 'tasksSub',
                localField: '_id',
                foreignField: 'parentTaskId',
                as: 'subTaskArr',
            }
        }
        stateDocument.push(tempStage);

        // pipeline
        const resultTasks = await ModelTask.aggregate(stateDocument);

        let taskStr = '';

        for (let index = 0; index < resultTasks.length; index++) {
            const element = resultTasks[index];
            taskStr += `----- \n`;
            taskStr += `Task ${index+1} -> title -> ${element.title}.\n`;
            taskStr += `Task ${index+1} -> description -> ${element.description}.\n`;
            taskStr += `Task ${index+1} -> priority -> ${element.priority}.\n`;
            taskStr += `Task ${index+1} -> dueDate -> ${element.dueDate}.\n`;
            taskStr += `Task ${index+1} -> isCompleted -> ${element.isCompleted ? 'Yes' : 'No'}.\n`;
            taskStr += `Task ${index+1} -> isArchived -> ${element.isArchived ? 'Yes' : 'No'}.\n`;
            taskStr += `Task ${index+1} -> labels -> ${element.labels.join(', ')}.\n`;
            if (element.taskWorkspace.length >= 1) {
                taskStr += `Task ${index+1} -> taskWorkspace -> ${element.taskWorkspace[0].title}.\n`;
            }
            if (element.taskStatusList.length >= 1) {
                taskStr += `Task ${index+1} -> taskStatusList -> ${element.taskStatusList[0].statusTitle}.\n`;
            }
            if (element.subTaskArr.length >= 1) {
                taskStr += `Task ${index+1} -> subTaskArr: \n`;
                for (let subIndex = 0; subIndex < element.subTaskArr.length; subIndex++) {
                    const subtask = element.subTaskArr[subIndex];
                    taskStr += `Task ${index+1} -> subtasks ${subIndex + 1} -> ${subtask.title} (${subtask.taskCompletedStatus ? 'completed' : 'pending'}) \n`;
                }
            }
            taskStr += '\n';
        }

        console.log('taskStr: ', taskStr);

        return taskStr;
    } catch (error) {
        console.error(error);
        return '';
    }
};

const suggestDailyTasksByAi = async ({
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
        
        // Step 2: Get task list by task schedule ID
        const taskStr = await getTaskList({
            auth_username: taskInfo.username,
        });

        if(taskStr === '') {
            return true;
        }

        // Step 3: validate api keys
        const apiKeys = await ModelUserApiKey.findOne({
            username: taskInfo.username,
            smtpValid: true,
        });
        if (!apiKeys) {
            return true;
        }

        // Step 4: get user email
        const userInfo = await ModelUser.findOne({
            username: taskInfo.username,
        });
        if (!userInfo) {
            return true;
        }

        // step 5.1: get current date
        // Use luxon to get the current date string in the user's timezone
        const currentDateInUserTz = DateTime.now().setZone(taskInfo.timezoneName);
        const dateStr = currentDateInUserTz.toFormat('yyyy-MM-dd');

        // Step 5.2: send mail
        await funcSendMail({
            username: taskInfo.username,
            smtpTo: userInfo.email,
            subject: `Daily Tasks Suggestion - ${dateStr}`,
            text: taskStr,
        });

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default suggestDailyTasksByAi;