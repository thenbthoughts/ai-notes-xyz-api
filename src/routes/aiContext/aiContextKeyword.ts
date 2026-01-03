import { Router, Request, Response } from 'express';
import mongoose, { PipelineStage } from 'mongoose';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelLlmContextKeyword } from '../../schema/schemaLlmContext/SchemaLlmContextKeyword.schema';
import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { ModelLifeEvents } from '../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import generateKeywordsBySourceId from '../../utils/llmPendingTask/page/featureAiAction/featureAiActionAll/keyword/generateKeywordsBySourceId';

const router = Router();

// List AI Context Keywords with aggregation
router.post('/list', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;

        let tempStage = {} as PipelineStage;
        const pipelineDocument = [] as PipelineStage[];
        const pipelineCount = [] as PipelineStage[];

        const page = parseInt(req.body?.page as string) || 1;
        const limit = parseInt(req.body?.limit as string) || 50;
        const skip = (page - 1) * limit;

        const sourceType = req.body?.sourceType as string;
        const sourceId = req.body?.sourceId as string;
        const keyword = req.body?.keyword as string;
        const aiCategory = req.body?.aiCategory as string;
        const aiSubCategory = req.body?.aiSubCategory as string;
        const aiTopic = req.body?.aiTopic as string;
        const aiSubTopic = req.body?.aiSubTopic as string;

        // stage -> match -> filters
        let matchStage = {
            username: auth_username
        } as {
            username: string;
            metadataSourceType?: string;
            metadataSourceId?: mongoose.Types.ObjectId;
            keyword?: { $regex: string; $options: string };
            aiCategory?: { $regex: string; $options: string };
            aiSubCategory?: { $regex: string; $options: string };
            aiTopic?: { $regex: string; $options: string };
            aiSubTopic?: { $regex: string; $options: string };
        };

        if (sourceType) {
            matchStage.metadataSourceType = sourceType;
        }

        if (sourceId) {
            const sourceIdObj = mongoose.Types.ObjectId.isValid(sourceId)
                ? new mongoose.Types.ObjectId(sourceId)
                : null;
            if (sourceIdObj) {
                matchStage.metadataSourceId = sourceIdObj;
            }
        }

        if (keyword) {
            matchStage.keyword = { $regex: keyword, $options: 'i' };
        }

        if (aiCategory) {
            matchStage.aiCategory = { $regex: aiCategory, $options: 'i' };
        }

        if (aiSubCategory) {
            matchStage.aiSubCategory = { $regex: aiSubCategory, $options: 'i' };
        }

        if (aiTopic) {
            matchStage.aiTopic = { $regex: aiTopic, $options: 'i' };
        }

        if (aiSubTopic) {
            matchStage.aiSubTopic = { $regex: aiSubTopic, $options: 'i' };
        }

        // stage -> match
        tempStage = { $match: matchStage };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // stage -> sort
        tempStage = { $sort: { createdAt: -1 } };
        pipelineDocument.push(tempStage);

        // stage -> skip
        tempStage = { $skip: skip };
        pipelineDocument.push(tempStage);

        // stage -> limit
        tempStage = { $limit: limit };
        pipelineDocument.push(tempStage);

        // stage -> project
        tempStage = {
            $project: {
                _id: 1,
                username: 1,
                keyword: 1,
                aiCategory: 1,
                aiSubCategory: 1,
                aiTopic: 1,
                aiSubTopic: 1,
                metadataSourceType: 1,
                metadataSourceId: 1,
                hasEmbedding: 1,
                createdAt: 1,
                updatedAt: 1,
            }
        };
        pipelineDocument.push(tempStage);

        // stageCount -> count
        tempStage = { $count: 'total' };
        pipelineCount.push(tempStage);

        const [keywordsResult, totalResult] = await Promise.all([
            ModelLlmContextKeyword.aggregate(pipelineDocument),
            ModelLlmContextKeyword.aggregate(pipelineCount)
        ]);

        const total = totalResult.length > 0 ? totalResult[0].total : 0;

        return res.json({
            message: 'Keywords retrieved successfully',
            count: total,
            docs: keywordsResult,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error listing AI context keywords:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// get group by ai category
router.post('/group-by-field', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;
        const { groupByField } = req.body;

        // Validate groupByField
        const validFields = ['aiCategory', 'aiSubCategory', 'aiTopic', 'aiSubTopic'];
        const fieldToGroupBy = validFields.includes(groupByField) ? groupByField : 'aiCategory';

        const groupedData = await ModelLlmContextKeyword.aggregate([
            { $match: { username: auth_username } },
            {
                $group: {
                    _id: `$${fieldToGroupBy}`,
                    count: { $sum: 1 },
                    keywords: { $push: '$keyword' }
                }
            },
            { $sort: { count: -1 } }
        ]);

        return res.json({
            message: `Keywords grouped by ${fieldToGroupBy} successfully`,
            groupedBy: fieldToGroupBy,
            data: groupedData
        });
    } catch (error) {
        console.error('Error grouping AI context keywords by field:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get keyword statistics using aggregation
router.post('/stats', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;

        const stats = await ModelLlmContextKeyword.aggregate([
            { $match: { username: auth_username } },
            {
                $facet: {
                    totalKeywords: [
                        { $count: 'count' }
                    ],
                    bySourceType: [
                        {
                            $group: {
                                _id: '$metadataSourceType',
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { count: -1 } }
                    ],
                    byCategory: [
                        {
                            $match: { aiCategory: { $ne: '', $exists: true } }
                        },
                        {
                            $group: {
                                _id: '$aiCategory',
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { count: -1 } },
                        { $limit: 20 }
                    ],
                    byTopic: [
                        {
                            $match: { aiTopic: { $ne: '', $exists: true } }
                        },
                        {
                            $group: {
                                _id: '$aiTopic',
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { count: -1 } },
                        { $limit: 20 }
                    ],
                    topKeywords: [
                        {
                            $group: {
                                _id: '$keyword',
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { count: -1 } },
                        { $limit: 50 }
                    ]
                }
            }
        ]);

        return res.json({
            message: 'Statistics retrieved successfully',
            totalKeywords: stats[0].totalKeywords[0]?.count || 0,
            bySourceType: stats[0].bySourceType,
            byCategory: stats[0].byCategory,
            byTopic: stats[0].byTopic,
            topKeywords: stats[0].topKeywords,
        });
    } catch (error) {
        console.error('Error getting keyword statistics:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Revalidate AI Context Keywords - Trigger keyword generation for all sources
router.post('/revalidate', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;

        // Check if user has valid API keys
        const userApi = await ModelUserApiKey.findOne({
            username: auth_username,
            $or: [
                { apiKeyGroqValid: true },
                { apiKeyOpenrouterValid: true },
            ],
        });

        if (!userApi) {
            return res.status(400).json({
                status: 'error',
                message: 'User API key not found or invalid',
            });
        }

        // Use aggregation to get all source IDs efficiently
        const [notesIds, tasksIds, lifeEventsIds, infoVaultIds] = await Promise.all([
            ModelNotes.aggregate([
                { $match: { username: auth_username } },
                { $project: { _id: 1 } }
            ]),
            ModelTask.aggregate([
                { $match: { username: auth_username } },
                { $project: { _id: 1 } }
            ]),
            ModelLifeEvents.aggregate([
                { $match: { username: auth_username } },
                { $project: { _id: 1 } }
            ]),
            ModelInfoVault.aggregate([
                { $match: { username: auth_username } },
                { $project: { _id: 1 } }
            ])
        ]);

        // Collect all IDs
        const allIds = [
            ...notesIds.map(item => item._id),
            ...tasksIds.map(item => item._id),
            ...lifeEventsIds.map(item => item._id),
            ...infoVaultIds.map(item => item._id)
        ];

        // Process keywords generation (this will run asynchronously)
        // In production, you'd want to queue these tasks
        const processKeywords = async () => {
            for (const id of allIds) {
                try {
                    await generateKeywordsBySourceId({
                        targetRecordId: id.toString()
                    });
                } catch (error) {
                    console.error(`Error generating keywords for ${id}:`, error);
                }
            }
        };

        // Start processing in background
        processKeywords().catch(error => {
            console.error('Error in background keyword processing:', error);
        });

        return res.json({
            message: 'AI context keywords generation started successfully',
            tasksQueued: allIds.length,
            breakdown: {
                notes: notesIds.length,
                tasks: tasksIds.length,
                lifeEvents: lifeEventsIds.length,
                infoVault: infoVaultIds.length,
            }
        });
    } catch (error) {
        console.error('Error revalidating AI context keywords:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;


