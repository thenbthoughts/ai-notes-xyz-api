import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';
import { tsTaskList } from '../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types';
import { ModelTaskWorkspace } from '../../schema/schemaTask/SchemaTaskWorkspace.schema';
import { ModelTaskStatusList } from '../../schema/schemaTask/SchemaTaskStatusList.schema';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelLlmPendingTaskCron } from '../../schema/SchemaLlmPendingTaskCron.schema';

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
                title?: RegExp;
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

                // task homepage pinned
                isTaskPinned,
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
            if(isTaskPinned) {
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

                    // status
                    isArchived,
                    isCompleted,
                    priority: priority || 'very-low',

                    // task homepage pinned
                    isTaskPinned: isTaskPinned || false,

                    // datetime ip
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

export default router;