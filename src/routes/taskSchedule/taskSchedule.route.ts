import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';
import { CronExpressionParser } from 'cron-parser';

import { ModelTaskSchedule } from '../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';
import { tsTaskListSchedule } from '../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';

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
        'suggestDailyTasksByAi'
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
        ]);

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
                        tz: 'UTC'
                    });

                    // Get next 100 occurrences for this cron expression
                    for (let i = 0; i < 1000; i++) {
                        const nextDate = interval.next().toDate();
                        scheduleExecutionTimeArr.push(nextDate);
                    }
                } catch (err: any) {
                    console.error(`Error parsing cron expression ${cronExpression}:`, err.message);
                }
            }

            // Sort all dates chronologically
            scheduleExecutionTimeArr.sort((a, b) => a.getTime() - b.getTime());

            // Take all dates across all cron expressions
            scheduleExecutionTimeArr.push(...scheduleExecutionTimeArr);
        }

        // step 2: scheduleTimeArr
        if (itemTaskSchedule.scheduleTimeArr && itemTaskSchedule.scheduleTimeArr.length > 0) {
            scheduleExecutionTimeArr.push(...itemTaskSchedule.scheduleTimeArr);
        }

        // remove duplicates
        scheduleExecutionTimeArr = [...new Set(scheduleExecutionTimeArr)];

        // sort by date
        scheduleExecutionTimeArr.sort((a, b) => a.getTime() - b.getTime());

        // take first 100 dates
        scheduleExecutionTimeArr = scheduleExecutionTimeArr.slice(0, 100);

        // step 3: update scheduleExecutionTimeArr
        await ModelTaskSchedule.updateOne(
            { _id: itemTaskSchedule._id },
            { $set: { scheduleExecutionTimeArr: scheduleExecutionTimeArr } }
        );
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

            let recordId = '';
            if (req.body?.recordId) {
                if (typeof req.body?.recordId === 'string') {
                    if (req.body?.recordId.trim() !== '') {
                        recordId = req.body?.recordId;
                    }
                }
            }

            let tempStage = {} as PipelineStage;
            const stateDocument = [] as PipelineStage[];

            // stateDocument -> match
            const tempStageMatch = {
                username: auth_username,
            } as {
                username: string;
                title?: RegExp;
                description?: RegExp;
                taskType?: string;
                isActive?: boolean;
                shouldSendEmail?: boolean;
            };

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

            // Execute aggregation
            const resultTaskSchedules = await ModelTaskSchedule.aggregate(stateDocument);

            // If specific record ID requested, return only that record
            if (recordId) {
                const recordIdObj = getMongodbObjectOrNull(recordId);
                if (recordIdObj) {
                    const specificRecord = await ModelTaskSchedule.findOne({
                        _id: recordIdObj,
                        username: auth_username,
                    });
                    if (specificRecord) {
                        return res.json({
                            message: 'Task schedule retrieved successfully',
                            count: 1,
                            docs: [specificRecord],
                        });
                    }
                }
            }

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
                timezoneOffset
            } = req.body;

            // Validate ID
            const taskScheduleIdObj = getMongodbObjectOrNull(_id);
            if (!taskScheduleIdObj) {
                return res.status(400).json({ message: 'Valid task schedule ID is required' });
            }

            // Validate task type if provided
            if (taskType && !isValidTaskType(taskType)) {
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

// taskScheduleToggleActive - Additional utility endpoint to quickly toggle active status
router.post('/taskScheduleToggleActive', middlewareUserAuth, middlewareActionDatetime, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;
        const { _id } = req.body;

        const taskScheduleIdObj = getMongodbObjectOrNull(_id);
        if (!taskScheduleIdObj) {
            return res.status(400).json({ message: 'Valid task schedule ID is required' });
        }

        const actionDatetimeObj = normalizeDateTimeIpAddress(
            res.locals.actionDatetime
        );

        // Find current task schedule
        const currentTaskSchedule = await ModelTaskSchedule.findOne({
            _id: taskScheduleIdObj,
            username: auth_username,
        });

        if (!currentTaskSchedule) {
            return res.status(404).json({ message: 'Task schedule not found' });
        }

        // Toggle active status
        const updatedTaskSchedule = await ModelTaskSchedule.findOneAndUpdate(
            {
                _id: taskScheduleIdObj,
                username: auth_username,
            },
            {
                isActive: !currentTaskSchedule.isActive,
                updatedAtUtc: actionDatetimeObj.updatedAtUtc,
                updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress,
                updatedAtUserAgent: actionDatetimeObj.updatedAtUserAgent,
            },
            {
                new: true,
            }
        );

        return res.json({
            message: `Task schedule ${updatedTaskSchedule?.isActive ? 'activated' : 'deactivated'} successfully`,
            taskSchedule: updatedTaskSchedule
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;