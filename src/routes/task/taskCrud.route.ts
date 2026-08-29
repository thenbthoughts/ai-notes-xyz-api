import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { DefaultDateTimeIpAddress, normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';
import { tsTaskList } from '../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types';
import { ModelTaskWorkspace } from '../../schema/schemaTask/SchemaTaskWorkspace.schema';
import { ModelTaskStatusList } from '../../schema/schemaTask/SchemaTaskStatusList.schema';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelLlmPendingTaskCron } from '../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { tsTaskStatusList } from '../../types/typesSchema/typesSchemaTask/SchemaTaskStatusList.types';
import { ModelCommentCommon } from '../../schema/schemaCommentCommon/SchemaCommentCommon.schema';
import { reindexDocument } from '../../utils/search/reindexGlobalSearch';
import { deleteFilesByParentEntityId } from '../upload/uploadFileS3ForFeatures';
import {
    computeReminderScheduledTimes,
    computeReminderScheduledTimesForDueDate,
} from '../../utils/task/computeReminderScheduledTimesTask';

export { computeReminderScheduledTimes, computeReminderScheduledTimesForDueDate };
import { ModelUser } from '../../schema/schemaUser/SchemaUser.schema';
import IUser from '../../types/typesSchema/typesUser/SchemaUser.types';

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

const doesTaskWorkspaceExistAndBelongToUser = async ({
    taskWorkspaceId,
    auth_userId
}: {
    taskWorkspaceId: string;
    auth_userId: string;
}) => {
    try {
        const taskWorkspaceIdObj = mongoose.Types.ObjectId.createFromHexString(taskWorkspaceId) || null;
        if (!taskWorkspaceIdObj) {
            return false;
        }

        const workspace = await ModelTaskWorkspace.findOne({
            _id: taskWorkspaceIdObj,
            userId: auth_userId,
        });

        if (workspace) {
            return true;
        }

        return false;
    } catch (error) {
        console.error(error);
        return false;
    }
}

const doesTaskStatusExistAndBelongToUser = async ({
    taskStatusId,
    auth_userId
}: {
    taskStatusId: string;
    auth_userId: string;
}) => {
    try {
        const taskStatusIdObj = mongoose.Types.ObjectId.createFromHexString(taskStatusId) || null;
        if (!taskStatusIdObj) {
            return false;
        }

        const taskStatus = await ModelTaskStatusList.findOne({
            _id: taskStatusIdObj,
            userId: auth_userId,
        });

        if (taskStatus) {
            return true;
        }

        return false;
    } catch (error) {
        console.error(error);
        return false;
    }
}

const assignTaskWorkspaceByTaskId = async ({
    _id,
    auth_userId,
}: {
    _id: mongoose.Types.ObjectId;
    auth_userId: string;
}) => {
    try {
        // Find or create "unassigned" task status
        let unassignedTaskWorkspace = await ModelTaskWorkspace.findOne({
            title: 'Unassigned',
            userId: auth_userId,
        });

        if (!unassignedTaskWorkspace) {
            // Create "unassigned" task status if it doesn't exist
            unassignedTaskWorkspace = await ModelTaskWorkspace.create({
                title: 'Unassigned',
                userId: auth_userId,
            });
        }

        // Update the task with the unassigned task status
        await ModelTask.findOneAndUpdate(
            {
                _id: _id,
                userId: auth_userId,
            },
            {
                taskWorkspaceId: unassignedTaskWorkspace._id,
            }
        );

        // reindex for global search
        await reindexDocument({
            reindexDocumentArr: [{
                collectionName: 'tasks',
                documentId: _id.toString(),
            }],
        });

        return unassignedTaskWorkspace._id as mongoose.Types.ObjectId;
    } catch (error) {
        console.error(error);
        return null;
    }
}

const assignTaskStatusByTaskId = async ({
    _id,
    auth_userId,
    taskWorkspaceId
}: {
    _id: mongoose.Types.ObjectId;
    auth_userId: string;
    taskWorkspaceId: mongoose.Types.ObjectId;
}) => {
    try {
        // Find or create "unassigned" task status
        let unassignedTaskStatus = await ModelTaskStatusList.findOne({
            taskWorkspaceId: taskWorkspaceId,
            userId: auth_userId,
            statusTitle: 'Unassigned',
        });

        if (!unassignedTaskStatus) {
            // Create "unassigned" task status if it doesn't exist
            unassignedTaskStatus = await ModelTaskStatusList.create({
                taskWorkspaceId: taskWorkspaceId,
                userId: auth_userId,
                statusTitle: 'Unassigned',
            });
        }

        console.log('unassignedTaskStatus: ', unassignedTaskStatus);

        // Update the task with the unassigned task status
        await ModelTask.findOneAndUpdate(
            {
                _id: _id,
                userId: auth_userId,
            },
            {
                taskWorkspaceId: taskWorkspaceId,
                taskStatusId: unassignedTaskStatus._id,
            }
        );

        // reindex for global search
        await reindexDocument({
            reindexDocumentArr: [{
                collectionName: 'tasks',
                documentId: _id.toString(),
            }],
        });

    } catch (error) {
        console.error(error);
    }
}

const revalidateAllTaskWorkspace = async ({
    auth_userId,
}: {
    auth_userId: string;
}) => {
    try {
        const pipeline = [
            {
                $match: {
                    userId: auth_userId,
                }
            },
            {
                $lookup: {
                    from: 'taskWorkspace',
                    let: {
                        let_userId: '$userId',
                        let_taskWorkspaceId: '$taskWorkspaceId',
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        {
                                            $eq: ['$userId', '$$let_userId'],
                                        },
                                        {
                                            $eq: ['$_id', '$$let_taskWorkspaceId'],
                                        }
                                    ]
                                }
                            }
                        }
                    ],
                    as: 'taskWorkspace',
                }
            },
            {
                $addFields: {
                    taskWorkspaceSize: {
                        $size: '$taskWorkspace',
                    },
                }
            },
            {
                $match: {
                    taskWorkspaceSize: 0,
                }
            }
        ];

        const taskArr = await ModelTask.aggregate(pipeline);

        for (let index = 0; index < taskArr.length; index++) {
            const element = taskArr[index];
            if (element.taskWorkspaceSize === 0) {
                await assignTaskWorkspaceByTaskId({
                    _id: element._id,
                    auth_userId: auth_userId,
                });
            }
        }
    } catch (error) {
        console.error(error);
    }
}

// taskAdd
router.post(
    '/taskAdd',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;

            const { title, description, taskWorkspaceId, taskStatusId } = req.body;

            // does task workspace exist and belong to user
            const taskWorkspaceIdObj = getMongodbObjectOrNull(taskWorkspaceId);
            if (!taskWorkspaceIdObj) {
                return res.status(400).json({ message: 'Task workspace ID is required' });
            }
            const resultDoesBelongToUser = await doesTaskWorkspaceExistAndBelongToUser({
                taskWorkspaceId: taskWorkspaceId,
                auth_userId: auth_userId,
            });
            if (!resultDoesBelongToUser) {
                return res.status(400).json({ message: 'Task workspace not found or unauthorized' });
            }

            const actionDatetimeObj = normalizeDateTimeIpAddress(
                res.locals.actionDatetime
            );

            // does task status exist and belong to user (optional)
            let taskStatusIdObj = getMongodbObjectOrNull(taskStatusId);
            if (!taskStatusIdObj) {
                taskStatusIdObj = null;
            } else {
                const resultDoesBelongToUserTaskStatus = await doesTaskStatusExistAndBelongToUser({
                    taskStatusId: taskStatusId,
                    auth_userId: auth_userId,
                });
                if (!resultDoesBelongToUserTaskStatus) {
                    taskStatusIdObj = null;
                }
            }

            const newTask = await ModelTask.create({
                // 
                title,
                description,
                priority: 'very-low',
                dueDate: null,

                // identification
                taskWorkspaceId: taskWorkspaceIdObj,
                taskStatusId: taskStatusIdObj,

                // auth
                userId: res.locals.auth_userId,

                // tagsAutoAi
                tagsAutoAi: ['To Do'],

                // date time ip
                ...actionDatetimeObj,
            });

            // reindex for global search
            await reindexDocument({
                reindexDocumentArr: [{
                    collectionName: 'tasks',
                    documentId: (newTask._id as mongoose.Types.ObjectId).toString(),
                }],
            });

            // generate Feature AI Actions by source id (includes FAQ, Summary, Tags, Embedding)
            await ModelLlmPendingTaskCron.create({
                userId: res.locals.auth_userId,
                taskType: llmPendingTaskTypes.page.featureAiActions.task,
                targetRecordId: newTask._id,
            });

            return res.status(201).json(newTask);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// taskGet
router.post(
    '/taskGet',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;

            // revalidate task workspace
            await revalidateAllTaskWorkspace({
                auth_userId: auth_userId,
            });

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
                userId: res.locals.auth_userId,
            } as {
                userId: string;
                title?: string;
                description?: RegExp;
                paginationDateLocalYearMonthStr?: string;
                priority?: string;
                isArchived?: boolean;
                isCompleted?: boolean;
                isTaskPinned?: boolean;
                dueDate?: Record<string, Date>;
                taskWorkspaceId?: mongoose.Types.ObjectId;
            };

            // Filter by task workspace id
            if (typeof req.body?.taskWorkspaceId === 'string') {
                if (req.body?.taskWorkspaceId.length === 24) {
                    let tempWorkspaceId = mongoose.Types.ObjectId.createFromHexString(req.body?.taskWorkspaceId);
                    if (tempWorkspaceId) {
                        tempStageMatch.taskWorkspaceId = tempWorkspaceId;
                    }
                }
            }

            // Filter title
            if (req.body?.title) {
                if (typeof req.body?.title === 'string') {
                    if (req.body?.title.trim() !== '') {
                        tempStageMatch.title = req.body?.title;
                    }
                }
            }

            // Filter by priority
            if (req.body?.priority) {
                if (typeof req.body?.priority === 'string') {
                    if (req.body?.priority.trim() !== '') {
                        tempStageMatch.priority = req.body?.priority;
                    }
                }
            }

            // Filter by archive status
            if (req.body?.isArchived) {
                if (typeof req.body?.isArchived === 'string') {
                    if (req.body?.isArchived === 'archived') {
                        tempStageMatch.isArchived = true;
                    } else if (req.body?.isArchived === 'not-archived') {
                        tempStageMatch.isArchived = false;
                    }
                }
            }

            // Filter by completion status
            if (req.body?.isCompleted) {
                if (typeof req.body?.isCompleted === 'string') {
                    if (req.body?.isCompleted === 'completed') {
                        tempStageMatch.isCompleted = true;
                    } else if (req.body?.isCompleted === 'not-completed') {
                        tempStageMatch.isCompleted = false;
                    }
                }
            }

            if (typeof req.body?.isTaskPinned === 'string' && req.body.isTaskPinned.trim() !== '') {
                if (req.body.isTaskPinned === 'pinned') {
                    tempStageMatch.isTaskPinned = true;
                } else if (req.body.isTaskPinned === 'unpinned') {
                    tempStageMatch.isTaskPinned = false;
                }
            }

            if (typeof req.body?.dueDateFrom === 'string' && req.body.dueDateFrom.trim() !== '') {
                const d = new Date(req.body.dueDateFrom);
                if (!Number.isNaN(d.getTime())) {
                    tempStageMatch.dueDate = tempStageMatch.dueDate || {};
                    (tempStageMatch.dueDate as Record<string, Date>).$gte = d;
                }
            }
            if (typeof req.body?.dueDateTo === 'string' && req.body.dueDateTo.trim() !== '') {
                const d = new Date(req.body.dueDateTo);
                if (!Number.isNaN(d.getTime())) {
                    tempStageMatch.dueDate = tempStageMatch.dueDate || {};
                    (tempStageMatch.dueDate as Record<string, Date>).$lte = d;
                }
            }

            tempStage = {
                $match: {
                    ...tempStageMatch,
                }
            }
            stateDocument.push(tempStage);

            // stage -> searchInput
            if (typeof req.body?.searchInput === 'string') {
                if (req.body.searchInput.length >= 1) {
                    let searchQuery = req.body.searchInput as string;

                    let searchQueryArr = searchQuery
                        .replace('-', ' ')
                        .split(' ');

                    // stage -> lookup -> comments
                    const lookupMatchCommentsAnd = [];
                    for (let iLookup = 0; iLookup < searchQueryArr.length; iLookup++) {
                        const elementStr = searchQueryArr[iLookup];
                        lookupMatchCommentsAnd.push({ commentText: { $regex: elementStr, $options: 'i' } });
                    }
                    tempStage = {
                        $lookup: {
                            from: 'commentsCommon',
                            let: { taskId: '$_id' },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: {
                                            $eq: ['$entityId', '$$taskId']
                                        },
                                        $or: [
                                            ...lookupMatchCommentsAnd,
                                        ],
                                    }
                                }
                            ],
                            as: 'commentSearch',
                        }
                    };
                    stateDocument.push(tempStage);

                    const matchAnd = [];
                    for (let index = 0; index < searchQueryArr.length; index++) {
                        const elementStr = searchQueryArr[index];
                        matchAnd.push({
                            $or: [
                                // notes
                                { title: { $regex: elementStr, $options: 'i' } },
                                { description: { $regex: elementStr, $options: 'i' } },
                                { priority: { $regex: elementStr, $options: 'i' } },
                                { labels: { $regex: elementStr, $options: 'i' } },
                                { labelsAi: { $regex: elementStr, $options: 'i' } },

                                // comment search
                                { 'commentSearch.commentText': { $regex: elementStr, $options: 'i' } },
                            ]
                        })
                    }

                    tempStage = {
                        $match: {
                            $and: [
                                ...matchAnd,
                            ],
                        },
                    };
                    stateDocument.push(tempStage);

                    // stage -> unset chatListSearch
                    tempStage = {
                        $unset: [
                            'commentSearch',
                        ],
                    };
                    stateDocument.push(tempStage);
                }
            }

            // stage -> match labelArr
            if (req.body?.labelArr) {
                if (Array.isArray(req.body?.labelArr)) {
                    if (req.body?.labelArr.length > 0) {
                        let labelArr = [] as string[];

                        let bodyLabelArr = req.body?.labelArr;
                        for (let index = 0; index < bodyLabelArr.length; index++) {
                            const element = bodyLabelArr[index];
                            if (typeof element === 'string') {
                                if (element.trim() !== '') {
                                    labelArr.push(element);
                                }
                            }
                        }

                        if (labelArr.length > 0) {
                            tempStage = {
                                $match: {
                                    $or: [
                                        {
                                            labels: { $in: labelArr },
                                        },
                                        {
                                            labelsAi: { $in: labelArr },
                                        },
                                    ]
                                }
                            }
                            stateDocument.push(tempStage);
                        }
                    }
                }
            }

            // stage -> match record id
            if (recordId.trim() !== '') {
                tempStage = {
                    $match: {
                        _id: new mongoose.Types.ObjectId(recordId),
                    }
                };
                stateDocument.push(tempStage);
            }

            // stateDocument -> sort
            tempStage = {
                $sort: {
                    title: 1,
                }
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
                                            $eq: ['$userId', res.locals.auth_userId]
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

            // stateDocument -> lookup task comments
            tempStage = {
                $lookup: {
                    from: 'commentsCommon',
                    localField: '_id',
                    foreignField: 'entityId',
                    as: 'taskComments',
                }
            }
            stateDocument.push(tempStage);

            // stateDocument -> lookup task sub task
            tempStage = {
                $lookup: {
                    from: 'tasksSub',
                    localField: '_id',
                    foreignField: 'parentTaskId',
                    as: 'tasksSub',
                }
            }
            stateDocument.push(tempStage);

            // pipeline
            const resultTasks = await ModelTask.aggregate(stateDocument).collation({ locale: 'en', strength: 2 });

            // revalidate task workspace and status
            for (let index = 0; index < resultTasks.length; index++) {
                const element = resultTasks[index];

                let shouldRevalidateWorkspace = false;
                let shouldRevalidateStatus = false;

                if (element.taskWorkspace.length === 0) {
                    shouldRevalidateWorkspace = true;
                    shouldRevalidateStatus = true;
                } else if (element.taskStatusList.length === 0) {
                    shouldRevalidateStatus = true;
                }


                let taskWorkspaceId = null as mongoose.Types.ObjectId | null;

                if (shouldRevalidateWorkspace) {
                    taskWorkspaceId = await assignTaskWorkspaceByTaskId({
                        _id: element._id,
                        auth_userId: res.locals.auth_userId,
                    });
                } else {
                    taskWorkspaceId = element.taskWorkspace[0]._id;
                }

                if (shouldRevalidateStatus) {
                    if (taskWorkspaceId) {
                        await assignTaskStatusByTaskId({
                            _id: element._id,
                            auth_userId: res.locals.auth_userId,
                            taskWorkspaceId: taskWorkspaceId,
                        });
                    }
                }
            }

            return res.json({
                message: 'Tasks retrieved successfully',
                count: resultTasks.length,
                docs: resultTasks,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Open (not archived, not completed) task counts per status list — aggregation only
router.post(
    '/taskGetOpenCountsByTaskStatus',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;

            await revalidateAllTaskWorkspace({
                auth_userId: auth_userId,
            });

            let taskWorkspaceIdObj: mongoose.Types.ObjectId | null = null;

            if (typeof req.body?.taskWorkspaceId === 'string') {
                if (req.body.taskWorkspaceId.length === 24) {
                    taskWorkspaceIdObj =
                        mongoose.Types.ObjectId.createFromHexString(req.body.taskWorkspaceId) || null;
                }
            }

            if (!taskWorkspaceIdObj) {
                return res.json({
                    message: 'Open counts by task status retrieved successfully',
                    docs: [] as { taskStatusId: string; count: number }[],
                });
            }

            const grouped = await ModelTask.aggregate([
                {
                    $match: {
                        userId: auth_userId,
                        taskWorkspaceId: taskWorkspaceIdObj,
                        isArchived: false,
                        isCompleted: false,
                    },
                },
                {
                    $group: {
                        _id: '$taskStatusId',
                        count: { $sum: 1 },
                    },
                },
                {
                    $project: {
                        _id: 0,
                        taskStatusId: { $toString: '$_id' },
                        count: 1,
                    },
                },
            ]);

            return res.json({
                message: 'Open counts by task status retrieved successfully',
                docs: grouped as { taskStatusId: string; count: number }[],
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    },
);

const taskEditTriggerAddComment = async ({
    taskId,
    taskStatusIdOld,
    taskStatusIdNew,
    auth_userId,

    actionDatetimeObj,
}: {
    taskId: string;
    taskStatusIdOld: string;
    taskStatusIdNew: string;
    auth_userId: string;

    actionDatetimeObj: DefaultDateTimeIpAddress;
}) => {
    try {
        if (taskStatusIdOld === taskStatusIdNew) {
            return;
        }

        // find task status old
        const resultTaskStatus = await ModelTaskStatusList.find({
            _id: {
                $in: [
                    mongoose.Types.ObjectId.createFromHexString(taskStatusIdOld),
                    mongoose.Types.ObjectId.createFromHexString(taskStatusIdNew)
                ],
            },
            userId: auth_userId,
        }) as tsTaskStatusList[];
        if (!resultTaskStatus) {
            return;
        }

        // find the status names
        let taskStatusOldName = '';
        let taskStatusNewName = '';

        for (const taskStatusItem of resultTaskStatus) {
            if (taskStatusItem._id.toString() === taskStatusIdOld) {
                taskStatusOldName = taskStatusItem.statusTitle;
            }
            if (taskStatusItem._id.toString() === taskStatusIdNew) {
                taskStatusNewName = taskStatusItem.statusTitle;
            }
        }

        await ModelCommentCommon.create({
            commentType: 'task',
            entityId: mongoose.Types.ObjectId.createFromHexString(taskId),

            commentText: 'Task status changed from ' + taskStatusOldName + ' to ' + taskStatusNewName,
            userId: auth_userId,

            // datetime ip
            ...actionDatetimeObj,
        });
    } catch (error) {
        console.error(error);
    }
}

// taskEdit
router.post(
    '/taskEdit',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;

            const actionDatetimeObj = normalizeDateTimeIpAddress(
                res.locals.actionDatetime
            );

            const {
                id,
                title,
                description,
                taskStatus,
                labels,
                isArchived,
                isCompleted,
                priority,
                taskWorkspaceId,
                taskStatusId,
                dueDate,

                // task homepage pinned
                isTaskPinned,

                reminderCustomTimes,
            } = req.body;

            const dueDateReminderPresetLabels = req.body.dueDateReminderPresetLabels;
            const dueDateReminderAbsoluteTimesIso = req.body.dueDateReminderAbsoluteTimesIso;
            const dueDateReminderCronExpressions = req.body.dueDateReminderCronExpressions;
            const remainderAbsoluteTimesIso = req.body.remainderAbsoluteTimesIso;
            const remainderCronExpressions = req.body.remainderCronExpressions;

            let final_taskWorkspaceIdObj = null as mongoose.Types.ObjectId | null;

            let taskWorkspaceIdObj = getMongodbObjectOrNull(taskWorkspaceId);
            if (!taskWorkspaceIdObj) {
                return res.status(400).json({ message: 'Task workspace ID is required' });
            }
            const resultDoesBelongToUser = await doesTaskWorkspaceExistAndBelongToUser({
                taskWorkspaceId: taskWorkspaceId,
                auth_userId: auth_userId,
            });
            if (!resultDoesBelongToUser) {
                return res.status(400).json({ message: 'Task workspace not found or unauthorized' });
            }

            let final_taskStatusId = null as mongoose.Types.ObjectId | null;
            if (taskStatusId) {
                const taskStatusIdObj = getMongodbObjectOrNull(taskStatusId);
                if (!taskStatusIdObj) {
                    return res.status(400).json({ message: 'Task status ID is required' });
                }
                const resultDoesBelongToUserTaskStatus = await doesTaskStatusExistAndBelongToUser({
                    taskStatusId: taskStatusId,
                    auth_userId: auth_userId,
                });
                if (!resultDoesBelongToUserTaskStatus) {
                    return res.status(400).json({ message: 'Task status not found or unauthorized' });
                }
                final_taskStatusId = taskStatusIdObj;
            }

            const updateObj = {} as Partial<tsTaskList>;
            updateObj.taskWorkspaceId = taskWorkspaceIdObj;
            if (final_taskStatusId) {
                updateObj.taskStatusId = final_taskStatusId;
            }

            const dateNow = new Date();

            // if task is pinned, update all other task pinned to false
            if (isTaskPinned) {
                await ModelTask.updateMany(
                    {
                        _id: { $ne: getMongodbObjectOrNull(id) },
                        userId: auth_userId,
                        isTaskPinned: true,
                    },
                    {
                        $set: {
                            isTaskPinned: false,
                        }
                    }
                );
            }

            // get task (lean)
            const task = await ModelTask.findOne({
                _id: getMongodbObjectOrNull(id),
                userId: auth_userId,
            }).lean();

            if (!task) {
                return res.status(404).json({ message: 'Task not found' });
            }

            // task edit trigger add comment
            await taskEditTriggerAddComment({
                taskId: id,
                taskStatusIdOld: (task.taskStatusId as { toString?: () => string })?.toString?.() || '',
                taskStatusIdNew: final_taskStatusId?.toString() || '',
                auth_userId: auth_userId,

                actionDatetimeObj: actionDatetimeObj,
            });

            const updatedTask = await ModelTask.findOneAndUpdate(
                {
                    _id: getMongodbObjectOrNull(id),
                    userId: auth_userId,
                },
                {
                    title,
                    description,
                    taskStatus,
                    labels,
                    dueDate,

                    // reminder input data
                    dueDateReminderPresetLabels,
                    dueDateReminderAbsoluteTimesIso,
                    dueDateReminderCronExpressions,
                    remainderAbsoluteTimesIso,
                    remainderCronExpressions,

                    // status
                    isArchived,
                    isCompleted,
                    priority: priority || 'very-low',

                    // task homepage pinned
                    isTaskPinned: isTaskPinned || false,

                    // updated datetime ip
                    updatedAtUtc: actionDatetimeObj.updatedAtUtc,
                    updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress,
                    updatedAtUserAgent: actionDatetimeObj.updatedAtUserAgent,

                    // identification
                    ...updateObj,
                },
                {
                    new: true,
                }
            );
            if (!updatedTask) {
                return res.status(404).json({ message: 'Task not found' });
            }

            // generate Feature AI Actions by source id
            await ModelLlmPendingTaskCron.create({
                userId: res.locals.auth_userId,
                taskType: llmPendingTaskTypes.page.featureAiActions.task,
                targetRecordId: updatedTask._id,
            });

            // reindex for global search
            await reindexDocument({
                reindexDocumentArr: [{
                    collectionName: 'tasks',
                    documentId: (updatedTask._id as mongoose.Types.ObjectId).toString(),
                }],
            });

            // get timezone name
            const userObj = await ModelUser.findById(auth_userId)
                .select('timeZoneRegion')
                .lean() as Pick<IUser, 'timeZoneRegion'> | null;

            const cronTimeZone = userObj?.timeZoneRegion || 'UTC';

            // compute reminder scheduled times
            await computeReminderScheduledTimes({
                taskId: updatedTask._id as mongoose.Types.ObjectId,
                cronTimeZone,
            });
            await computeReminderScheduledTimesForDueDate({
                taskId: updatedTask._id as mongoose.Types.ObjectId,
                cronTimeZone,
            });

            return res.json({
                message: 'Task edited successfully',
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

router.post('/taskDelete', middlewareUserAuth, middlewareActionDatetime, async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        const auth_userId = res.locals.auth_userId;
        const deletedTask = await ModelTask.findOneAndDelete({ _id: getMongodbObjectOrNull(id), userId: auth_userId });
        if (!deletedTask) {
            return res.status(404).json({ message: 'Task not found' });
        }
        return res.json({ message: 'Task permanently deleted' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/taskBulkEdit', middlewareUserAuth, middlewareActionDatetime, async (req: Request, res: Response) => {
    try {
        const auth_userId = res.locals.auth_userId;
        const { ids, taskStatusId, isCompleted, isArchived } = req.body as { ids: string[]; taskStatusId?: string; isCompleted?: boolean; isArchived?: boolean };
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids required' });
        }
        if (ids.length > 100) {
            return res.status(400).json({ message: 'Too many ids' });
        }
        const objectIds = ids.map((x) => getMongodbObjectOrNull(x)).filter((x) => { return x !== null; }) as mongoose.Types.ObjectId[];
        if (objectIds.length === 0) {
            return res.status(400).json({ message: 'Invalid ids' });
        }
        const update: Record<string, unknown> = {};
        const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);
        update.updatedAtUtc = actionDatetimeObj.updatedAtUtc;
        update.updatedAtIpAddress = actionDatetimeObj.updatedAtIpAddress;
        update.updatedAtUserAgent = actionDatetimeObj.updatedAtUserAgent;
        if (typeof taskStatusId === 'string' && taskStatusId.length === 24) {
            const ok = await doesTaskStatusExistAndBelongToUser({ taskStatusId, auth_userId });
            if (!ok) {
                return res.status(400).json({ message: 'Status not found' });
            }
            update.taskStatusId = mongoose.Types.ObjectId.createFromHexString(taskStatusId);
        }
        if (typeof isCompleted === 'boolean') update.isCompleted = isCompleted;
        if (typeof isArchived === 'boolean') update.isArchived = isArchived;
        if (Object.keys(update).length <= 3) {
            return res.status(400).json({ message: 'No fields to update' });
        }
        const result = await ModelTask.updateMany({ _id: { $in: objectIds }, userId: auth_userId }, { $set: update });
        return res.json({ message: 'Bulk updated', modifiedCount: result.modifiedCount });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/taskImport', middlewareUserAuth, middlewareActionDatetime, async (req: Request, res: Response) => {
    try {
        const auth_userId = res.locals.auth_userId;
        const { taskWorkspaceId, taskStatusId, tasks: importTasks } = req.body as { taskWorkspaceId: string; taskStatusId?: string; tasks: { title: string; description?: string; priority?: string; dueDate?: string; labels?: string[] }[] };
        if (!Array.isArray(importTasks) || importTasks.length === 0) {
            return res.status(400).json({ message: 'tasks required' });
        }
        if (importTasks.length > 200) {
            return res.status(400).json({ message: 'Too many tasks' });
        }
        const workspaceIdObj = getMongodbObjectOrNull(taskWorkspaceId);
        if (!workspaceIdObj) return res.status(400).json({ message: 'Workspace required' });
        const okWs = await doesTaskWorkspaceExistAndBelongToUser({ taskWorkspaceId, auth_userId });
        if (!okWs) return res.status(400).json({ message: 'Workspace not found' });
        let statusIdObj: mongoose.Types.ObjectId | null = null;
        if (typeof taskStatusId === 'string' && taskStatusId.length === 24) {
            const ok = await doesTaskStatusExistAndBelongToUser({ taskStatusId, auth_userId });
            if (ok) statusIdObj = mongoose.Types.ObjectId.createFromHexString(taskStatusId);
        }
        const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);
        const docs = importTasks.slice(0, 200).filter((t) => typeof t.title === 'string' && t.title.trim()).map((t) => {
            const due = t.dueDate ? new Date(t.dueDate) : null;
            return {
                title: t.title.trim().slice(0, 200),
                description: (t.description || '').slice(0, 5000),
                priority: ['very-low', 'low', 'medium', 'high', 'very-high'].includes(t.priority || '') ? t.priority : 'very-low',
                dueDate: due && !Number.isNaN(due.getTime()) ? due : null,
                labels: Array.isArray(t.labels) ? t.labels.filter((x) => typeof x === 'string').slice(0, 10) : [],
                labelsAi: [],
                taskWorkspaceId: workspaceIdObj,
                taskStatusId: statusIdObj,
                userId: auth_userId,
                ...actionDatetimeObj,
            };
        });
        if (docs.length === 0) return res.status(400).json({ message: 'No valid tasks' });
        const inserted = await ModelTask.insertMany(docs);
        return res.json({ message: 'Imported', count: inserted.length });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// taskLabelsByWorkspaceId
router.post('/taskLabelsByWorkspaceId', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const {
            workspaceId
        } = req.body;
        const auth_userId = res.locals.auth_userId;

        const workspaceIdObj = getMongodbObjectOrNull(workspaceId);
        if (!workspaceIdObj) {
            return res.status(400).json({ message: 'Workspace ID is required' });
        }

        const resultDoesBelongToUser = await doesTaskWorkspaceExistAndBelongToUser({
            taskWorkspaceId: workspaceId,
            auth_userId: auth_userId,
        });
        if (!resultDoesBelongToUser) {
            return res.status(400).json({ message: 'Workspace not found or unauthorized' });
        }

        const labelAggregation = await ModelTask.aggregate([
            {
                $match: {
                    userId: auth_userId,
                    taskWorkspaceId: workspaceIdObj,
                }
            },
            {
                $project: {
                    allLabels: {
                        $concatArrays: [
                            { $ifNull: ["$labels", []] },
                            { $ifNull: ["$labelsAi", []] }
                        ]
                    }
                }
            },
            {
                $unwind: "$allLabels"
            },
            {
                $project: {
                    labelLower: { $toLower: "$allLabels" }
                }
            },
            {
                $group: {
                    _id: "$labelLower",
                    count: { $sum: 1 }
                }
            },
            {
                $sort: {
                    count: -1,
                    _id: 1,
                }
            }
        ]).collation({
            locale: 'en',
            strength: 2,
        });

        return res.json({
            message: 'Task labels retrieved successfully',
            labels: labelAggregation,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;