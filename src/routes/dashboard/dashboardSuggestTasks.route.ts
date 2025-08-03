import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';

// Router
const router = Router();

// task-get-suggestions
router.get(
    '/task-get-suggestions',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;

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

            console.log(
                JSON.stringify(stateDocument, null, 2)
            );

            // pipeline
            const resultTasks = await ModelTask.aggregate(stateDocument);

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

export default router;