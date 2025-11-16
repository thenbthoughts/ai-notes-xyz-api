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
    auth_username
}: {
    taskWorkspaceId: string;
    auth_username: string;
}) => {
    try {
        const taskWorkspaceIdObj = mongoose.Types.ObjectId.createFromHexString(taskWorkspaceId) || null;
        if (!taskWorkspaceIdObj) {
            return false;
        }

        const workspace = await ModelTaskWorkspace.findOne({
            _id: taskWorkspaceIdObj,
            username: auth_username,
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
    auth_username
}: {
    taskStatusId: string;
    auth_username: string;
}) => {
    try {
        const taskStatusIdObj = mongoose.Types.ObjectId.createFromHexString(taskStatusId) || null;
        if (!taskStatusIdObj) {
            return false;
        }

        const taskStatus = await ModelTaskStatusList.findOne({
            _id: taskStatusIdObj,
            username: auth_username,
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
    auth_username,
}: {
    _id: mongoose.Types.ObjectId;
    auth_username: string;
}) => {
    try {
        // Find or create "unassigned" task status
        let unassignedTaskWorkspace = await ModelTaskWorkspace.findOne({
            title: 'Unassigned',
            username: auth_username,
        });

        if (!unassignedTaskWorkspace) {
            // Create "unassigned" task status if it doesn't exist
            unassignedTaskWorkspace = await ModelTaskWorkspace.create({
                title: 'Unassigned',
                username: auth_username,
            });
        }

        // Update the task with the unassigned task status
        await ModelTask.findOneAndUpdate(
            {
                _id: _id,
                username: auth_username,
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
            username: auth_username,
        });

        return unassignedTaskWorkspace._id as mongoose.Types.ObjectId;
    } catch (error) {
        console.error(error);
        return null;
    }
}

const assignTaskStatusByTaskId = async ({
    _id,
    auth_username,
    taskWorkspaceId
}: {
    _id: mongoose.Types.ObjectId;
    auth_username: string;
    taskWorkspaceId: mongoose.Types.ObjectId;
}) => {
    try {
        // Find or create "unassigned" task status
        let unassignedTaskStatus = await ModelTaskStatusList.findOne({
            taskWorkspaceId: taskWorkspaceId,
            username: auth_username,
            statusTitle: 'Unassigned',
        });

        if (!unassignedTaskStatus) {
            // Create "unassigned" task status if it doesn't exist
            unassignedTaskStatus = await ModelTaskStatusList.create({
                taskWorkspaceId: taskWorkspaceId,
                username: auth_username,
                statusTitle: 'Unassigned',
            });
        }

        console.log('unassignedTaskStatus: ', unassignedTaskStatus);

        // Update the task with the unassigned task status
        await ModelTask.findOneAndUpdate(
            {
                _id: _id,
                username: auth_username,
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
            username: auth_username,
        });

    } catch (error) {
        console.error(error);
    }
}

const revalidateAllTaskWorkspace = async ({
    auth_username,
}: {
    auth_username: string;
}) => {
    try {
        const pipeline = [
            {
                $match: {
                    username: auth_username,
                }
            },
            {
                $lookup: {
                    from: 'taskWorkspace',
                    let: {
                        let_username: '$username',
                        let_taskWorkspaceId: '$taskWorkspaceId',
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        {
                                            $eq: ['$username', '$$let_username'],
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
                    auth_username: auth_username,
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
            const auth_username = res.locals.auth_username;

            const { title, description, taskWorkspaceId, taskStatusId } = req.body;

            // does task workspace exist and belong to user
            const taskWorkspaceIdObj = getMongodbObjectOrNull(taskWorkspaceId);
            if (!taskWorkspaceIdObj) {
                return res.status(400).json({ message: 'Task workspace ID is required' });
            }
            const resultDoesBelongToUser = await doesTaskWorkspaceExistAndBelongToUser({
                taskWorkspaceId: taskWorkspaceId,
                auth_username: auth_username,
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
                    auth_username: auth_username,
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
                username: res.locals.auth_username,

                // tagsAutoAi
                tagsAutoAi: ['To Do'],

                // date time ip
                ...actionDatetimeObj,
            });

            // generate embedding by id
            await ModelLlmPendingTaskCron.create({
                username: res.locals.auth_username,
                taskType: llmPendingTaskTypes.page.task.generateEmbeddingByTaskId,
                targetRecordId: newTask._id,
            });

            // reindex for global search
            await reindexDocument({
                reindexDocumentArr: [{
                    collectionName: 'tasks',
                    documentId: (newTask._id as mongoose.Types.ObjectId).toString(),
                }],
                username: res.locals.auth_username,
            });

            // generate keywords by id
            await ModelLlmPendingTaskCron.create({
                username: res.locals.auth_username,
                taskType: llmPendingTaskTypes.page.llmContext.generateKeywordsBySourceId,
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
            const auth_username = res.locals.auth_username;

            // revalidate task workspace
            await revalidateAllTaskWorkspace({
                auth_username: auth_username,
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
                username: res.locals.auth_username,
            } as {
                username: string;
                title?: string;
                description?: RegExp;
                paginationDateLocalYearMonthStr?: string;
                priority?: string;
                isArchived?: boolean;
                isCompleted?: boolean;
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
                                            $eq: ['$username', res.locals.auth_username]
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
                        auth_username: res.locals.auth_username,
                    });
                } else {
                    taskWorkspaceId = element.taskWorkspace[0]._id;
                }

                if (shouldRevalidateStatus) {
                    if (taskWorkspaceId) {
                        await assignTaskStatusByTaskId({
                            _id: element._id,
                            auth_username: res.locals.auth_username,
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

const taskEditTriggerAddComment = async ({
    taskId,
    taskStatusIdOld,
    taskStatusIdNew,
    auth_username,

    actionDatetimeObj,
}: {
    taskId: string;
    taskStatusIdOld: string;
    taskStatusIdNew: string;
    auth_username: string;

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
            username: auth_username,
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
            username: auth_username,

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
            const auth_username = res.locals.auth_username;

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

                // remainder
                reminderPresetTimeLabel,
                reminderCustomTimes,
            } = req.body;

            let final_taskWorkspaceIdObj = null as mongoose.Types.ObjectId | null;

            let taskWorkspaceIdObj = getMongodbObjectOrNull(taskWorkspaceId);
            if (!taskWorkspaceIdObj) {
                return res.status(400).json({ message: 'Task workspace ID is required' });
            }
            const resultDoesBelongToUser = await doesTaskWorkspaceExistAndBelongToUser({
                taskWorkspaceId: taskWorkspaceId,
                auth_username: auth_username,
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
                    auth_username: auth_username,
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
                        username: auth_username,
                        isTaskPinned: true,
                    },
                    {
                        $set: {
                            isTaskPinned: false,
                        }
                    }
                );
            }

            // get task
            const task = await ModelTask.findOne({
                _id: getMongodbObjectOrNull(id),
                username: auth_username,
            });

            if (!task) {
                return res.status(404).json({ message: 'Task not found' });
            }

            // task edit trigger add comment
            await taskEditTriggerAddComment({
                taskId: id,
                taskStatusIdOld: task.taskStatusId?.toString() || '',
                taskStatusIdNew: final_taskStatusId?.toString() || '',
                auth_username: auth_username,

                actionDatetimeObj: actionDatetimeObj,
            });

            // remainder
            if (reminderPresetTimeLabel && dueDate) {
                // Simple calculation of reminder times based on dueDate and preset labels (lowercase, minus)
                const labelToMsArr: { labelName: string, subTime: number }[] = [
                    { labelName: "before-60-day", subTime: 60 * 24 * 60 * 60 * 1000 },
                    { labelName: "before-30-day", subTime: 30 * 24 * 60 * 60 * 1000 },
                    { labelName: "before-15-day", subTime: 15 * 24 * 60 * 60 * 1000 },
                    { labelName: "before-5-day", subTime: 5 * 24 * 60 * 60 * 1000 },
                    { labelName: "before-3-day", subTime: 3 * 24 * 60 * 60 * 1000 },
                    { labelName: "before-1-day", subTime: 24 * 60 * 60 * 1000 },
                    { labelName: "before-6-hours", subTime: 6 * 60 * 60 * 1000 },
                    { labelName: "before-3-hours", subTime: 3 * 60 * 60 * 1000 },
                    { labelName: "before-1-hours", subTime: 60 * 60 * 1000 },
                    { labelName: "before-30-mins", subTime: 30 * 60 * 1000 },
                    { labelName: "before-15-mins", subTime: 15 * 60 * 1000 },
                    { labelName: "at-the-time-of-due-date", subTime: 0 },
                ];

                let presetTimes: Date[] = [];

                if (reminderPresetTimeLabel && dueDate) {
                    const normalizedLabel = typeof reminderPresetTimeLabel === "string" ? reminderPresetTimeLabel.toLowerCase() : "";
                    const found = labelToMsArr.find(item => item.labelName === normalizedLabel);
                    if (found) {
                        const relatedLabels = labelToMsArr.filter(item => {
                            if (
                                Math.min(item.subTime, found.subTime) === item.subTime
                            ) {
                                return true;
                            }
                            return false;
                        });
                        presetTimes = relatedLabels.map(item => new Date(new Date(dueDate).getTime() - item.subTime));
                    }
                }

                updateObj.reminderPresetTimeLabel = reminderPresetTimeLabel;
                updateObj.reminderPresetTimes = presetTimes;
            }

            const updatedTask = await ModelTask.findOneAndUpdate(
                {
                    _id: getMongodbObjectOrNull(id),
                    username: auth_username,
                },
                {
                    title,
                    description,
                    taskStatus,
                    labels,
                    dueDate,

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

            // generate embedding by id
            await ModelLlmPendingTaskCron.create({
                username: res.locals.auth_username,
                taskType: llmPendingTaskTypes.page.task.generateEmbeddingByTaskId,
                targetRecordId: updatedTask._id,
            });

            // generate keywords by id
            await ModelLlmPendingTaskCron.create({
                username: res.locals.auth_username,
                taskType: llmPendingTaskTypes.page.llmContext.generateKeywordsBySourceId,
                targetRecordId: updatedTask._id,
            });

            // reindex for global search
            await reindexDocument({
                reindexDocumentArr: [{
                    collectionName: 'tasks',
                    documentId: (updatedTask._id as mongoose.Types.ObjectId).toString(),
                }],
                username: res.locals.auth_username,
            });

            return res.json(updatedTask);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// taskDelete
router.post('/taskDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const {
            id
        } = req.body;
        const auth_username = res.locals.auth_username;

        const deletedTask = await ModelTask.findOneAndDelete({
            _id: id,
            username: auth_username,
        });
        if (!deletedTask) {
            return res.status(404).json({ message: 'Task not found' });
        }
        // TODO delete task comments
        // TODO delete task list
        return res.json({ message: 'Task deleted successfully' });
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
        const auth_username = res.locals.auth_username;

        const workspaceIdObj = getMongodbObjectOrNull(workspaceId);
        if (!workspaceIdObj) {
            return res.status(400).json({ message: 'Workspace ID is required' });
        }

        const resultDoesBelongToUser = await doesTaskWorkspaceExistAndBelongToUser({
            taskWorkspaceId: workspaceId,
            auth_username: auth_username,
        });
        if (!resultDoesBelongToUser) {
            return res.status(400).json({ message: 'Workspace not found or unauthorized' });
        }

        const labelAggregation = await ModelTask.aggregate([
            {
                $match: {
                    username: auth_username,
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