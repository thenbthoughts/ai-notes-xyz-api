import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';
import { CronExpressionParser } from 'cron-parser';

import { ModelTaskSchedule } from '../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';
import { tsTaskListSchedule } from '../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';
import { ModelLlmPendingTaskCron } from '../../schema/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelTaskScheduleAddTask } from '../../schema/schemaTaskSchedule/SchemaTaskScheduleTaskAdd.schema';
import { tsTaskListScheduleAddTask } from '../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListScheduleAddTask.types';
import { tsTaskListScheduleSendMyselfEmail } from '../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListScheduleSendMyselfEmail.types';
import { ModelTaskScheduleSendMyselfEmail } from '../../schema/schemaTaskSchedule/SchemaTaskScheduleSendMyselfEmail.schema';

// Router
const router = Router();

const getMongodbObjectOrNull = (id: string | null) => {
    if (!id) {
        return null;
    }
    if (typeof id !== 'string') {
        return null;
    }
    if (id.length !== 24) {
        return null;
    }
    return mongoose.Types.ObjectId.createFromHexString(id) || null;
}

// Validate cron expression (basic validation)
const isValidCronExpression = (cronExpression: string): boolean => {
    if (!cronExpression || typeof cronExpression !== 'string') {
        return false;
    }

    // Basic cron validation - should have 5 or 6 parts
    const parts = cronExpression.trim().split(/\s+/);
    return parts.length === 5 || parts.length === 6;
}

// Validate task type
const isValidTaskType = (taskType: string): boolean => {
    const validTaskTypes = [
        'taskAdd',
        'notesAdd',
        'customRestApiCall',
        'generatedDailySummaryByAi',
        'suggestDailyTasksByAi',
        'sendMyselfEmail',
    ];
    return validTaskTypes.includes(taskType);
}

// revalidate task schedule execution time by id
export const revalidateTaskScheduleExecutionTimeById = async ({
    _id,
    auth_username,
}: {
    _id: string;
    auth_username: string;
}) => {
    // get offset value
    let SECOND_TO_MILLISECOND = 1000;
    let SECOND_SIXTY = 60;

    try {
        const resultTaskSchedule = await ModelTaskSchedule.aggregate([
            {
                $match: {
                    _id: getMongodbObjectOrNull(_id),
                    username: auth_username,
                }
            },
            {
                $addFields: {
                    cronExpressionArrLen: {
                        $size: '$cronExpressionArr'
                    },
                    scheduleTimeArrLen: {
                        $size: '$scheduleTimeArr'
                    }
                }
            },
            {
                $match: {
                    $or: [
                        {
                            cronExpressionArrLen: { $gt: 0 }
                        },
                        {
                            scheduleTimeArrLen: { $gt: 0 }
                        }
                    ]
                }
            }
        ]) as tsTaskListSchedule[];

        if (resultTaskSchedule.length === 0) {
            return;
        }

        let scheduleExecutionTimeArr: Date[] = [];
        const itemTaskSchedule = resultTaskSchedule[0];

        // step 1: cron expressions
        if (itemTaskSchedule.cronExpressionArr && itemTaskSchedule.cronExpressionArr.length > 0) {
            for (const cronExpression of itemTaskSchedule.cronExpressionArr) {
                try {
                    const interval = CronExpressionParser.parse(cronExpression, {
                        currentDate: new Date(),
                        tz: itemTaskSchedule.timezoneName
                    });

                    // Get next 101 occurrences for this cron expression
                    for (let i = 0; i < 101; i++) {
                        const nextDate = interval.next().toDate();

                        // add date to scheduleExecutionTimeArr
                        scheduleExecutionTimeArr.push(nextDate);
                    }
                } catch (err: any) {
                    console.error(`Error parsing cron expression ${cronExpression}:`, err.message);
                }
            }
        }

        // step 2: scheduleTimeArr
        if (itemTaskSchedule.scheduleTimeArr && itemTaskSchedule.scheduleTimeArr.length > 0) {
            for (const scheduleTime of itemTaskSchedule.scheduleTimeArr) {
                let date = new Date(scheduleTime);

                // get offset value
                let offsetValueOf = itemTaskSchedule.timezoneOffset * SECOND_SIXTY * SECOND_TO_MILLISECOND;

                // get date utc execute
                let dateUtcExecute = date.valueOf() - offsetValueOf;
                let dateUtcExecuteDate = new Date(dateUtcExecute);

                // add date to scheduleExecutionTimeArr
                scheduleExecutionTimeArr.push(dateUtcExecuteDate);
            }
        }

        // remove duplicates
        scheduleExecutionTimeArr = [...new Set(scheduleExecutionTimeArr)];

        // sort by date
        scheduleExecutionTimeArr.sort((a, b) => a.getTime() - b.getTime());

        // take first 101 dates
        scheduleExecutionTimeArr = scheduleExecutionTimeArr.slice(0, 101);

        // step 3: update scheduleExecutionTimeArr
        await ModelTaskSchedule.updateOne(
            { _id: itemTaskSchedule._id },
            { $set: { scheduleExecutionTimeArr: scheduleExecutionTimeArr } }
        );
    } catch (error) {
        console.error(error);
    }
}

// execute task schedule
export const executeTaskSchedule = async ({
    auth_username,
}: {
    auth_username: string;
}) => {
    try {
        const itemTaskSchedules = await ModelTaskSchedule.aggregate([
            {
                $match: {
                    username: auth_username,
                    isActive: true,
                }
            },
            {
                $addFields: {
                    cronExpressionArrLen: {
                        $size: '$cronExpressionArr'
                    },
                    scheduleTimeArrLen: {
                        $size: '$scheduleTimeArr'
                    },
                    scheduleExecutionTimeArrLen: {
                        $size: '$scheduleExecutionTimeArr'
                    }
                }
            },
            {
                $match: {
                    $or: [
                        {
                            cronExpressionArrLen: { $gt: 0 }
                        },
                        {
                            scheduleTimeArrLen: { $gt: 0 }
                        }
                    ],
                    scheduleExecutionTimeArrLen: { $gt: 0 }
                }
            }
        ]) as tsTaskListSchedule[];

        for (const itemTaskSchedule of itemTaskSchedules) {

            const scheduleExecutionTimeArr = itemTaskSchedule.scheduleExecutionTimeArr;

            for (const scheduleExecutionTime of scheduleExecutionTimeArr) {
                let shouldExecute = true;

                // is time less than current time
                let dateUtcExecute = new Date(scheduleExecutionTime).valueOf();
                let currentTimeValueOf = new Date().valueOf();

                if ((currentTimeValueOf - dateUtcExecute) / 1000 >= 1) {
                    // may execute now
                } else {
                    shouldExecute = false;
                    continue;
                }

                // check in scheduleExecutedTimeArr
                if (Array.isArray(itemTaskSchedule.scheduleExecutedTimeArr)) {
                    let doesExist = false;

                    for (const scheduleExecutedTime of itemTaskSchedule.scheduleExecutedTimeArr) {
                        if (scheduleExecutedTime.valueOf() === scheduleExecutionTime.valueOf()) {
                            doesExist = true;
                            break;
                        }
                    }

                    if (doesExist) {
                        // dont execute now as time is already executed
                        shouldExecute = false;
                        continue;
                    }
                }

                if (shouldExecute) {
                    // can execute now

                    // update scheduleExecutedTimeArr
                    await ModelTaskSchedule.updateOne(
                        { _id: itemTaskSchedule._id },
                        {
                            $push: { scheduleExecutedTimeArr: scheduleExecutionTime },
                            $inc: { executedTimes: 1 }
                        }
                    );

                    // revalidate
                    let recordId = (itemTaskSchedule._id as mongoose.Types.ObjectId).toString();
                    await revalidateTaskScheduleExecutionTimeById({
                        _id: recordId,
                        auth_username: auth_username,
                    });

                    // insert record in llmPendingTaskCron
                    let tempTaskType = '';
                    if (itemTaskSchedule.taskType === 'suggestDailyTasksByAi') {
                        tempTaskType = llmPendingTaskTypes.page.taskSchedule.taskSchedule_suggestDailyTasksByAi;
                    } else if (itemTaskSchedule.taskType === 'taskAdd') {
                        tempTaskType = llmPendingTaskTypes.page.taskSchedule.taskSchedule_taskAdd;
                    } else if (itemTaskSchedule.taskType === 'generatedDailySummaryByAi') {
                        tempTaskType = llmPendingTaskTypes.page.taskSchedule.taskSchedule_generateDailySummaryByUserId;
                    } else if (itemTaskSchedule.taskType === 'sendMyselfEmail') {
                        tempTaskType = llmPendingTaskTypes.page.taskSchedule.taskSchedule_sendMyselfEmail;
                    }
                    if (tempTaskType !== '') {
                        await ModelLlmPendingTaskCron.create({
                            username: auth_username,
                            taskType: tempTaskType,
                            targetRecordId: itemTaskSchedule._id,
                        });
                    }

                    break;
                }

            }
        }

    } catch (error) {
        console.error(error);
    }
}

export const executeTaskScheduleForAllUsers = async () => {
    try {
        // get all user task schedules
        const itemTaskSchedules = await ModelTaskSchedule.aggregate([
            {
                $group: {
                    _id: '$username',
                    username: { $first: '$username' },
                }
            },
            {
                $project: {
                    _id: 0,
                    username: 1,
                }
            }
        ]) as {
            username: string;
        }[];

        for (const itemTaskSchedule of itemTaskSchedules) {
            await executeTaskSchedule({
                auth_username: itemTaskSchedule.username,
            });
        }
    } catch (error) {
        console.error(error);
    }
}

// taskScheduleAdd
router.post(
    '/taskScheduleAdd',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;

            const {
                title,
                description,
                taskType,
                isActive,
                shouldSendEmail,
                scheduleTimeArr,
                cronExpressionArr,
                timezoneName,
                timezoneOffset
            } = req.body;

            // Validate required fields
            if (!taskType || !isValidTaskType(taskType)) {
                return res.status(400).json({
                    message: 'Valid task type is required. Must be one of: taskAdd, notesAdd, customRestApiCall, generatedDailySummaryByAi, suggestDailyTasksByAi'
                });
            }

            // Validate cron expressions if provided
            if (cronExpressionArr && Array.isArray(cronExpressionArr)) {
                for (const cronExpr of cronExpressionArr) {
                    if (!isValidCronExpression(cronExpr)) {
                        return res.status(400).json({
                            message: `Invalid cron expression: ${cronExpr}`
                        });
                    }
                }
            }

            // Validate schedule times if provided
            let validScheduleTimeArr: Date[] = [];
            if (scheduleTimeArr && Array.isArray(scheduleTimeArr)) {
                for (const timeStr of scheduleTimeArr) {
                    const date = new Date(timeStr);
                    if (isNaN(date.getTime())) {
                        return res.status(400).json({
                            message: `Invalid schedule time: ${timeStr}`
                        });
                    }
                    validScheduleTimeArr.push(date);
                }
            }

            const actionDatetimeObj = normalizeDateTimeIpAddress(
                res.locals.actionDatetime
            );

            const newTaskSchedule = await ModelTaskSchedule.create({
                // auth
                username: auth_username,

                // required
                isActive: isActive !== undefined ? Boolean(isActive) : true,
                shouldSendEmail: shouldSendEmail !== undefined ? Boolean(shouldSendEmail) : false,
                taskType: taskType,

                // content
                title: title || '',
                description: description || '',

                // schedule time
                scheduleTimeArr: validScheduleTimeArr,

                // cron
                cronExpressionArr: cronExpressionArr || [],

                // timezone
                timezoneName: timezoneName || 'Asia/Kolkata',
                timezoneOffset: timezoneOffset || 330,

                // date time ip
                ...actionDatetimeObj,
            });

            // revalidate task schedule execution time
            if (newTaskSchedule._id) {
                await revalidateTaskScheduleExecutionTimeById({
                    _id: newTaskSchedule._id.toString(),
                    auth_username: auth_username,
                });
            }

            return res.status(201).json(newTaskSchedule);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// taskScheduleGet
router.post(
    '/taskScheduleGet',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;

            let tempStage = {} as PipelineStage;
            const stateDocument = [] as PipelineStage[];

            // stateDocument -> match
            const tempStageMatch = {
                username: auth_username,
            } as {
                _id?: mongoose.Types.ObjectId;
                username: string;
                title?: RegExp;
                description?: RegExp;
                taskType?: string;
                isActive?: boolean;
                shouldSendEmail?: boolean;
            };

            // Filter by recordId
            if (req.body?.recordId) {
                if (typeof req.body?.recordId === 'string') {
                    if (req.body?.recordId.trim() !== '') {
                        const recordIdObj = getMongodbObjectOrNull(req.body?.recordId);
                        if (recordIdObj) {
                            tempStageMatch._id = recordIdObj;
                        }
                    }
                }
            }

            // Filter by task type
            if (req.body?.taskType) {
                if (typeof req.body?.taskType === 'string') {
                    if (req.body?.taskType.trim() !== '') {
                        tempStageMatch.taskType = req.body?.taskType;
                    }
                }
            }

            // Filter by active status
            if (req.body?.isActive !== undefined) {
                if (typeof req.body?.isActive === 'boolean') {
                    tempStageMatch.isActive = req.body?.isActive;
                } else if (typeof req.body?.isActive === 'string') {
                    if (req.body?.isActive === 'active') {
                        tempStageMatch.isActive = true;
                    } else if (req.body?.isActive === 'inactive') {
                        tempStageMatch.isActive = false;
                    }
                }
            }

            // Filter by email notification
            if (req.body?.shouldSendEmail !== undefined) {
                if (typeof req.body?.shouldSendEmail === 'boolean') {
                    tempStageMatch.shouldSendEmail = req.body?.shouldSendEmail;
                } else if (typeof req.body?.shouldSendEmail === 'string') {
                    if (req.body?.shouldSendEmail === 'true') {
                        tempStageMatch.shouldSendEmail = true;
                    } else if (req.body?.shouldSendEmail === 'false') {
                        tempStageMatch.shouldSendEmail = false;
                    }
                }
            }

            // Search by title
            if (req.body?.title) {
                if (typeof req.body?.title === 'string') {
                    if (req.body?.title.trim() !== '') {
                        tempStageMatch.title = new RegExp(req.body?.title, 'i');
                    }
                }
            }

            // Search by description
            if (req.body?.description) {
                if (typeof req.body?.description === 'string') {
                    if (req.body?.description.trim() !== '') {
                        tempStageMatch.description = new RegExp(req.body?.description, 'i');
                    }
                }
            }

            tempStage = {
                $match: {
                    ...tempStageMatch,
                }
            };
            stateDocument.push(tempStage);

            // Sort by creation date (newest first)
            tempStage = {
                $sort: {
                    createdAtUtc: -1,
                }
            };
            stateDocument.push(tempStage);

            // Limit results (default 50, max 200)
            let limit = 50;
            if (req.body?.limit) {
                if (typeof req.body?.limit === 'number') {
                    if (req.body?.limit > 0 && req.body?.limit <= 200) {
                        limit = req.body?.limit;
                    }
                }
            }

            tempStage = {
                $limit: limit
            };
            stateDocument.push(tempStage);

            // lookup task add
            tempStage = {
                $lookup: {
                    from: 'taskScheduleAddTask',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'taskAddArr',
                }
            };
            stateDocument.push(tempStage);

            // lookup send myself email
            tempStage = {
                $lookup: {
                    from: 'taskScheduleSendMyselfEmail',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'sendMyselfEmailArr',
                }
            };
            stateDocument.push(tempStage);

            // Execute aggregation
            const resultTaskSchedules = await ModelTaskSchedule.aggregate(stateDocument);

            return res.json({
                message: 'Task schedules retrieved successfully',
                count: resultTaskSchedules.length,
                docs: resultTaskSchedules,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// taskScheduleEdit
router.post(
    '/taskScheduleEdit',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;

            const actionDatetimeObj = normalizeDateTimeIpAddress(
                res.locals.actionDatetime
            );

            const {
                _id,
                title,
                description,
                taskType,
                isActive,
                shouldSendEmail,
                scheduleTimeArr,
                cronExpressionArr,
                timezoneName,
                timezoneOffset,

                // 
                taskAddObj: arg_taskAddObj,
                sendMyselfEmailObj: arg_sendMyselfEmailObj,
            } = req.body;

            // Validate ID
            const taskScheduleIdObj = getMongodbObjectOrNull(_id);
            if (!taskScheduleIdObj) {
                return res.status(400).json({ message: 'Valid task schedule ID is required' });
            }

            // Validate task type if provided
            if (taskType && !isValidTaskType(taskType)) {
                return res.status(400).json({
                    message: 'Valid task type is required. Must be one of: taskAdd, notesAdd, customRestApiCall, generatedDailySummaryByAi, suggestDailyTasksByAi, sendMyselfEmail'
                });
            }

            // Validate cron expressions if provided
            if (cronExpressionArr && Array.isArray(cronExpressionArr)) {
                for (const cronExpr of cronExpressionArr) {
                    if (!isValidCronExpression(cronExpr)) {
                        return res.status(400).json({
                            message: `Invalid cron expression: ${cronExpr}`
                        });
                    }
                }
            }

            // Validate schedule times if provided
            let validScheduleTimeArr: Date[] | undefined = undefined;
            if (scheduleTimeArr && Array.isArray(scheduleTimeArr)) {
                validScheduleTimeArr = [];
                for (const timeStr of scheduleTimeArr) {
                    const date = new Date(timeStr);
                    if (isNaN(date.getTime())) {
                        return res.status(400).json({
                            message: `Invalid schedule time: ${timeStr}`
                        });
                    }
                    validScheduleTimeArr.push(date);
                }
            }

            // Build update object
            const updateObj = {} as Partial<tsTaskListSchedule>;

            if (title !== undefined) updateObj.title = title;
            if (description !== undefined) updateObj.description = description;
            if (taskType !== undefined) updateObj.taskType = taskType;
            if (isActive !== undefined) updateObj.isActive = Boolean(isActive);
            if (shouldSendEmail !== undefined) updateObj.shouldSendEmail = Boolean(shouldSendEmail);
            if (validScheduleTimeArr !== undefined) updateObj.scheduleTimeArr = validScheduleTimeArr;
            if (cronExpressionArr !== undefined) updateObj.cronExpressionArr = cronExpressionArr;

            // timezone
            if (timezoneName !== undefined) updateObj.timezoneName = timezoneName;
            if (timezoneOffset !== undefined) updateObj.timezoneOffset = timezoneOffset;

            // Add update datetime
            updateObj.updatedAtUtc = actionDatetimeObj.updatedAtUtc || undefined;
            updateObj.updatedAtIpAddress = actionDatetimeObj.updatedAtIpAddress;
            updateObj.updatedAtUserAgent = actionDatetimeObj.updatedAtUserAgent;

            const updatedTaskSchedule = await ModelTaskSchedule.findOneAndUpdate(
                {
                    _id: taskScheduleIdObj,
                    username: auth_username,
                },
                updateObj,
                {
                    new: true,
                }
            );

            // task type add task
            if (taskType === 'taskAdd') {
                const taskAddObj = arg_taskAddObj as unknown as tsTaskListScheduleAddTask;
                if (taskAddObj) {
                    const taskAddObjId = new mongoose.Types.ObjectId();

                    // delete existing task add
                    await ModelTaskScheduleAddTask.deleteMany({
                        $or: [
                            {
                                _id: taskScheduleIdObj,
                            },
                            {
                                taskScheduleId: taskScheduleIdObj,
                            },
                        ]
                    });

                    // create new task add
                    await ModelTaskScheduleAddTask.create({
                        // identification
                        _id: taskScheduleIdObj,
                        taskScheduleId: taskScheduleIdObj,
                        taskWorkspaceId: taskAddObj.taskWorkspaceId || null,
                        taskStatusId: taskAddObj.taskStatusId || null,

                        // auth
                        username: auth_username,

                        // task fields
                        taskTitle: taskAddObj.taskTitle,
                        taskDatePrefix: taskAddObj.taskDatePrefix,
                        taskDateTimePrefix: taskAddObj.taskDateTimePrefix,

                        // deadline enabled
                        taskDeadlineEnabled: taskAddObj.taskDeadlineEnabled,
                        taskDeadlineDays: taskAddObj.taskDeadlineDays,

                        // task ai fields
                        taskAiSummary: taskAddObj.taskAiSummary,
                        taskAiContext: taskAddObj.taskAiContext,

                        // subtaskArr
                        subtaskArr: taskAddObj.subtaskArr,
                    });
                }
            } else if (taskType === 'sendMyselfEmail') {
                const sendMyselfEmailObj = arg_sendMyselfEmailObj as tsTaskListScheduleSendMyselfEmail;
                if (sendMyselfEmailObj) {
                    // delete existing send myself email
                    await ModelTaskScheduleSendMyselfEmail.deleteMany({
                        $or: [
                            {
                                _id: taskScheduleIdObj,
                            },
                        ]
                    });

                    // create new send myself email
                    await ModelTaskScheduleSendMyselfEmail.create({
                        // identification
                        _id: taskScheduleIdObj,
                        username: auth_username,
                        taskScheduleId: taskScheduleIdObj,

                        // email fields -> staticContent
                        emailSubject: sendMyselfEmailObj.emailSubject || '',
                        emailContent: sendMyselfEmailObj.emailContent || '',

                        // ai fields -> aiConversationMail
                        aiEnabled: sendMyselfEmailObj.aiEnabled || false,
                        passAiContextEnabled: sendMyselfEmailObj.passAiContextEnabled || false,
                        systemPrompt: sendMyselfEmailObj.systemPrompt || '',
                        userPrompt: sendMyselfEmailObj.userPrompt || '',

                        // model info
                        aiModelName: sendMyselfEmailObj.aiModelName || '',
                        aiModelProvider: sendMyselfEmailObj.aiModelProvider || '',
                    });
                }
            }

            if (!updatedTaskSchedule) {
                return res.status(404).json({ message: 'Task schedule not found' });
            }

            // revalidate task schedule execution time
            await revalidateTaskScheduleExecutionTimeById({
                _id: _id,
                auth_username: auth_username,
            });

            return res.json(updatedTaskSchedule);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// taskScheduleDelete
router.post('/taskScheduleDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const {
            _id
        } = req.body;
        const auth_username = res.locals.auth_username;

        const taskScheduleIdObj = getMongodbObjectOrNull(_id);
        if (!taskScheduleIdObj) {
            return res.status(400).json({ message: 'Valid task schedule ID is required' });
        }

        const deletedTaskSchedule = await ModelTaskSchedule.findOneAndDelete({
            _id: taskScheduleIdObj,
            username: auth_username,
        });

        if (!deletedTaskSchedule) {
            return res.status(404).json({ message: 'Task schedule not found' });
        }

        return res.json({
            message: 'Task schedule deleted successfully',
            deletedTaskSchedule: deletedTaskSchedule
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;