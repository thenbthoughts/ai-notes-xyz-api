import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelLlmPendingTaskCron } from '../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { reindexDocument } from '../../utils/search/reindexGlobalSearch';
import { ModelInfoVaultSignificantDate } from '../../schema/schemaInfoVault/SchemaInfoVaultSignificantDate.schema';
import { deleteFilesByParentEntityId } from '../upload/uploadFileS3ForFeatures';

const router = Router();

// Get InfoVault API
router.post('/infoVaultGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let tempStage = {} as PipelineStage;
        const pipelineDocument: PipelineStage[] = [];
        const pipelineCount: PipelineStage[] = [];

        // args
        let page = 1;
        let perPage = 10;

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

        // stage -> match -> auth
        tempStage = {
            $match: {
                username: res.locals.auth_username,
            }
        };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // stage -> match -> recordId
        const arg_recordId = req.body.recordId;
        if (typeof arg_recordId === 'string') {
            if (arg_recordId.length === 24) {
                let _id = null as mongoose.Types.ObjectId | null;
                _id = arg_recordId ? mongoose.Types.ObjectId.createFromHexString(arg_recordId) : null;
                if (_id) {
                    if (_id.toHexString().length === 24) {
                        tempStage = {
                            $match: {
                                _id: _id,
                            }
                        };
                        pipelineDocument.push(tempStage);
                        pipelineCount.push(tempStage);
                    }
                }
            }
        }

        // stage -> match -> infoVaultType
        if (typeof req.body?.infoVaultType === 'string') {
            if (req.body.infoVaultType.length >= 1) {
                tempStage = {
                    $match: {
                        infoVaultType: req.body.infoVaultType,
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> match -> isFavorite
        if (typeof req.body?.isFavorite === 'string') {
            if (
                req.body?.isFavorite === 'true' ||
                req.body?.isFavorite === 'false'
            ) {
                const isFavorite = req.body?.isFavorite === 'true';
                tempStage = {
                    $match: {
                        isFavorite: isFavorite,
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> match -> relationshipType
        if (typeof req.body?.relationshipType === 'string') {
            if (['personal', 'professional', 'family', 'other'].includes(req.body.relationshipType)) {
                tempStage = {
                    $match: {
                        relationshipType: req.body.relationshipType,
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> match -> isArchived
        if (typeof req.body?.isArchived === 'string') {
            if (
                req.body?.isArchived === 'true' ||
                req.body?.isArchived === 'false'
            ) {
                const isArchived = req.body?.isArchived === 'true';
                tempStage = {
                    $match: {
                        isArchived: isArchived,
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> search
        if (typeof req.body?.search === 'string') {
            if (req.body.search.length >= 1) {
                let searchQuery = req.body.search as string;

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
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);

                const matchAnd = [];
                for (let index = 0; index < searchQueryArr.length; index++) {
                    const elementStr = searchQueryArr[index];
                    matchAnd.push({
                        $or: [
                            // info vault
                            { name: { $regex: elementStr, $options: 'i' } },
                            { nickname: { $regex: elementStr, $options: 'i' } },
                            { company: { $regex: elementStr, $options: 'i' } },
                            { jobTitle: { $regex: elementStr, $options: 'i' } },
                            { department: { $regex: elementStr, $options: 'i' } },
                            { notes: { $regex: elementStr, $options: 'i' } },
                            { tags: { $regex: elementStr, $options: 'i' } },
                            { aiSummary: { $regex: elementStr, $options: 'i' } },
                            { aiTags: { $regex: elementStr, $options: 'i' } },
                            { aiSuggestions: { $regex: elementStr, $options: 'i' } },

                            // comment search
                            { 'commentSearch.commentText': { $regex: elementStr, $options: 'i' } },
                        ]
                    });
                }

                tempStage = {
                    $match: {
                        $and: [
                            ...matchAnd,
                        ],
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);

                // stage -> unset chatListSearch
                tempStage = {
                    $unset: [
                        'commentSearch',
                    ],
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> sort -> name
        tempStage = {
            $sort: {
                name: 1,
            },
        };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // stage -> skip
        tempStage = {
            $skip: (page - 1) * perPage,
        };
        pipelineDocument.push(tempStage);

        // stage -> limit
        tempStage = {
            $limit: perPage,
        };
        pipelineDocument.push(tempStage);

        // stageCount -> count
        pipelineCount.push({
            $count: 'count'
        });

        const infoVault = await ModelInfoVault.aggregate(pipelineDocument);
        const infoVaultCount = await ModelInfoVault.aggregate(pipelineCount);

        let totalCount = 0;
        if (infoVaultCount.length === 1) {
            if (infoVaultCount[0].count) {
                totalCount = infoVaultCount[0].count;
            }
        }

        return res.json({
            message: 'InfoVault retrieved successfully',
            count: totalCount,
            docs: infoVault,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete InfoVault API
router.post('/infoVaultDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'InfoVault ID cannot be null' });
        }

        const infoVault = await ModelInfoVault.findOneAndDelete({
            _id: _id,
            username: res.locals.auth_username,
        });

        if (!infoVault) {
            return res.status(404).json({ message: 'InfoVault not found or unauthorized' });
        }

        // delete files from s3
        await deleteFilesByParentEntityId({
            username: res.locals.auth_username,
            parentEntityId: _id.toString(),
        });

        return res.json({ message: 'InfoVault deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add InfoVault API
router.post('/infoVaultAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let name = `New InfoVault - ${new Date().toDateString()} ${new Date().toLocaleTimeString().substring(0, 7)}`;

        const now = new Date();
        const newInfoVault = await ModelInfoVault.create({
            username: res.locals.auth_username,

            name,

            createdAtUtc: now,
            createdAtIpAddress: req.ip || '',
            createdAtUserAgent: req.headers['user-agent'] || '',
            updatedAtUtc: now,
            updatedAtIpAddress: req.ip || '',
            updatedAtUserAgent: req.headers['user-agent'] || '',
        });

        // generate Feature AI Actions by source id
        await ModelLlmPendingTaskCron.create({
            username: res.locals.auth_username,
            taskType: llmPendingTaskTypes.page.featureAiActions.infoVault,
            targetRecordId: newInfoVault._id,
        });

        // reindex all significant dates for this InfoVault
        const significantDates = await ModelInfoVaultSignificantDate.find({
            infoVaultId: newInfoVault._id,
            username: res.locals.auth_username,
        });
        if (significantDates.length > 0) {
            await reindexDocument({
                reindexDocumentArr: significantDates.map(sd => ({
                    collectionName: 'infoVault',
                    documentId: (sd._id as mongoose.Types.ObjectId).toString(),
                })),
            });
        }

        return res.json({
            message: 'InfoVault added successfully',
            doc: newInfoVault,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Edit InfoVault API
router.post('/infoVaultEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'InfoVault ID cannot be null' });
        }

        const updateObj = {} as any;
        if (typeof req.body.infoVaultType === 'string') {
            updateObj.infoVaultType = req.body.infoVaultType;
        }
        if (typeof req.body.infoVaultSubType === 'string') {
            updateObj.infoVaultSubType = req.body.infoVaultSubType;
        }
        if (typeof req.body.name === 'string') {
            updateObj.name = req.body.name;
        }
        if (typeof req.body.nickname === 'string') {
            updateObj.nickname = req.body.nickname;
        }
        if (typeof req.body.photoUrl === 'string') {
            updateObj.photoUrl = req.body.photoUrl;
        }
        if (typeof req.body.company === 'string') {
            updateObj.company = req.body.company;
        }
        if (typeof req.body.jobTitle === 'string') {
            updateObj.jobTitle = req.body.jobTitle;
        }
        if (typeof req.body.department === 'string') {
            updateObj.department = req.body.department;
        }
        if (typeof req.body.notes === 'string') {
            updateObj.notes = req.body.notes;
        }
        if (Array.isArray(req.body.tags)) {
            updateObj.tags = req.body.tags;
        }
        if (typeof req.body.isFavorite === 'boolean') {
            updateObj.isFavorite = req.body.isFavorite;
        }
        if (['myself', 'personal', 'professional', 'family', 'other'].includes(req.body.relationshipType)) {
            updateObj.relationshipType = req.body.relationshipType;
        }
        if (req.body.lastContactDate) {
            updateObj.lastContactDate = new Date(req.body.lastContactDate);
        }
        if (['', 'daily', 'weekly', 'monthly', 'yearly', 'rarely'].includes(req.body.contactFrequency)) {
            updateObj.contactFrequency = req.body.contactFrequency;
        }
        if (typeof req.body.aiSummary === 'string') {
            updateObj.aiSummary = req.body.aiSummary;
        }
        if (Array.isArray(req.body.aiTags)) {
            updateObj.aiTags = req.body.aiTags;
        }
        if (typeof req.body.aiSuggestions === 'string') {
            updateObj.aiSuggestions = req.body.aiSuggestions;
        }
        if (typeof req.body.isArchived === 'boolean') {
            updateObj.isArchived = req.body.isArchived;
        }
        if (typeof req.body.isBlocked === 'boolean') {
            updateObj.isBlocked = req.body.isBlocked;
        }
        updateObj.lastUpdatedBy = res.locals.auth_username;
        updateObj.updatedAtUtc = new Date();
        updateObj.updatedAtIpAddress = req.ip || '';
        updateObj.updatedAtUserAgent = req.headers['user-agent'] || '';

        if (Object.keys(updateObj).length >= 1) {
            await ModelInfoVault.updateOne(
                {
                    _id: _id,
                    username: res.locals.auth_username,
                },
                {
                    $set: {
                        ...updateObj,
                    }
                }
            );
        }

        // generate Feature AI Actions by source id
        await ModelLlmPendingTaskCron.create({
            username: res.locals.auth_username,
            taskType: llmPendingTaskTypes.page.featureAiActions.infoVault,
            targetRecordId: _id,
        });

        // reindex all significant dates for this InfoVault
        const significantDates = await ModelInfoVaultSignificantDate.find({
            infoVaultId: _id,
            username: res.locals.auth_username,
        });
        if (significantDates.length > 0) {
            await reindexDocument({
                reindexDocumentArr: significantDates.map(sd => ({
                    collectionName: 'infoVault',
                    documentId: (sd._id as mongoose.Types.ObjectId).toString(),
                })),
            });
        }

        return res.json({
            message: 'InfoVault edited successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router; 