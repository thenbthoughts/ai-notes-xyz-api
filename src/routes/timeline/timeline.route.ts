import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';

import { ModelRecordEmptyTable } from '../../schema/schemaOther/NoRecordTable';

// Router
const router = Router();

const getUnionPipeline = ({
    userId,
    collectionName,
}: {
    userId: string;
    collectionName: 'tasks' | 'notes' | 'lifeEvents' | 'infoVault' | 'chatLlmThread';
}) => {
    if (collectionName === 'tasks') {
        return {
            $unionWith: {
                coll: 'tasks',
                pipeline: [
                    {
                        $match: {
                            userId: userId,
                        }
                    },
                    {
                        $addFields: {
                            entityType: 'task',
                            entityId: '$_id',
                        }
                    }
                ]
            }
        };
    }

    if (collectionName === 'notes') {
        return {
            $unionWith: {
                coll: 'notes',
                pipeline: [
                    {
                        $match: {
                            userId: userId,
                        }
                    },
                    {
                        $addFields: {
                            entityType: 'note',
                            entityId: '$_id',
                        }
                    }
                ]
            }
        };
    }

    if (collectionName === 'lifeEvents') {
        return {
            $unionWith: {
                coll: 'lifeEvents',
                pipeline: [
                    {
                        $match: {
                            userId: userId,
                        }
                    },
                    {
                        $addFields: {
                            entityType: 'lifeEvent',
                            entityId: '$_id',
                        }
                    }
                ]
            }
        };
    }

    if (collectionName === 'chatLlmThread') {
        return {
            $unionWith: {
                coll: 'chatLlmThread',
                pipeline: [
                    {
                        $match: {
                            userId: userId,
                        }
                    },
                    {
                        $addFields: {
                            entityType: 'chatLlmThread',
                            entityId: '$_id',
                        }
                    }
                ]
            }
        };
    }

    if (collectionName === 'infoVault') {
        return {
            $unionWith: {
                coll: 'infoVault',
                pipeline: [
                    {
                        $match: {
                            userId: userId,
                        }
                    },
                    {
                        $addFields: {
                            entityType: 'infoVault',
                            entityId: '$_id',
                        }
                    }
                ]
            }
        };
    }

    return null;
};

// Get Timeline API
router.post('/timelineGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // args
        let page = 1;
        let perPage = 20;

        // set arg -> page
        if (typeof req.body?.page === 'number') {
            if (req.body.page >= 1) {
                page = req.body.page;
            }
        }
        // set arg -> perPage
        if (typeof req.body?.perPage === 'number') {
            if (req.body.perPage >= 1) {
                perPage = req.body.perPage;
            }
        }

        const userId = res.locals.auth_userId;
        let tempStage = {} as PipelineStage;
        const pipelineDocument: PipelineStage[] = [];
        const pipelineCount: PipelineStage[] = [];

        // union pipeline -> task
        const unionPipelineTasks = getUnionPipeline({
            userId: userId,
            collectionName: 'tasks',
        });
        if (unionPipelineTasks !== null) {
            pipelineDocument.push(unionPipelineTasks);
            pipelineCount.push(unionPipelineTasks);
        }

        // union pipeline -> note
        const unionPipelineNotes = getUnionPipeline({
            userId: userId,
            collectionName: 'notes',
        });
        if (unionPipelineNotes !== null) {
            pipelineDocument.push(unionPipelineNotes);
            pipelineCount.push(unionPipelineNotes);
        }

        // union pipeline -> lifeEvent
        const unionPipelineLifeEvents = getUnionPipeline({
            userId: userId,
            collectionName: 'lifeEvents',
        });
        if (unionPipelineLifeEvents !== null) {
            pipelineDocument.push(unionPipelineLifeEvents);
            pipelineCount.push(unionPipelineLifeEvents);
        }

        // union pipeline -> chatLlmThread
        const unionPipelineChatLlmThread = getUnionPipeline({
            userId: userId,
            collectionName: 'chatLlmThread',
        });
        if (unionPipelineChatLlmThread !== null) {
            pipelineDocument.push(unionPipelineChatLlmThread);
            pipelineCount.push(unionPipelineChatLlmThread);
        }

        // union pipeline -> infoVault
        const unionPipelineInfoVault = getUnionPipeline({
            userId: userId,
            collectionName: 'infoVault',
        });
        if (unionPipelineInfoVault !== null) {
            pipelineDocument.push(unionPipelineInfoVault);
            pipelineCount.push(unionPipelineInfoVault);
        }

        // Sort stage
        tempStage = {
            $sort: { updatedAtUtc: -1 }
        };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // Pagination
        tempStage = {
            $skip: (page - 1) * perPage
        };
        pipelineDocument.push(tempStage);
        tempStage = {
            $limit: perPage
        };
        pipelineDocument.push(tempStage);

        // Count pipeline
        tempStage = {
            $count: 'count'
        };
        pipelineCount.push(tempStage);

        // Execute aggregation
        const resultTimeline = await ModelRecordEmptyTable.aggregate(pipelineDocument);
        const countResult = await ModelRecordEmptyTable.aggregate(pipelineCount);
        const totalCount = countResult.length > 0 ? (countResult[0]?.count || 0) : 0;

        return res.json({
            message: 'Timeline retrieved successfully',
            docs: resultTimeline,
            count: totalCount,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;

