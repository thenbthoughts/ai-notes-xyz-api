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
                userId: res.locals.auth_userId,
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
            if (['myself', 'personal', 'professional', 'family', 'other'].includes(req.body.relationshipType)) {
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
            userId: res.locals.auth_userId,
        });

        if (!infoVault) {
            return res.status(404).json({ message: 'InfoVault not found or unauthorized' });
        }

        // delete files from s3
        await deleteFilesByParentEntityId({
            userId: res.locals.auth_userId,
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
            userId: res.locals.auth_userId,

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
            userId: res.locals.auth_userId,
            taskType: llmPendingTaskTypes.page.featureAiActions.infoVault,
            targetRecordId: newInfoVault._id,
        });

        // reindex all significant dates for this InfoVault
        const significantDates = await ModelInfoVaultSignificantDate.find({
            infoVaultId: newInfoVault._id,
            userId: res.locals.auth_userId,
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
        updateObj.lastUpdatedBy = res.locals.auth_userId;
        updateObj.updatedAtUtc = new Date();
        updateObj.updatedAtIpAddress = req.ip || '';
        updateObj.updatedAtUserAgent = req.headers['user-agent'] || '';

        if (Object.keys(updateObj).length >= 1) {
            await ModelInfoVault.updateOne(
                {
                    _id: _id,
                    userId: res.locals.auth_userId,
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
            userId: res.locals.auth_userId,
            taskType: llmPendingTaskTypes.page.featureAiActions.infoVault,
            targetRecordId: _id,
        });

        // reindex all significant dates for this InfoVault
        const significantDates = await ModelInfoVaultSignificantDate.find({
            infoVaultId: _id,
            userId: res.locals.auth_userId,
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

router.post('/infoVaultImport', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const rows = req.body?.rows;
        if (!Array.isArray(rows)) {
            return res.status(400).json({ message: 'rows must be an array' });
        }
        if (rows.length === 0) {
            return res.status(400).json({ message: 'rows is empty' });
        }
        if (rows.length > 500) {
            return res.status(400).json({ message: 'max 500 rows per import' });
        }
        const now = new Date();
        const created: string[] = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i] as Record<string, unknown>;
            const nameRaw = typeof r.name === 'string' ? (r.name as string).trim() : '';
            if (nameRaw.length === 0) {
                continue;
            }
            const company = typeof r.company === 'string' ? (r.company as string).trim().slice(0, 200) : '';
            const jobTitle = typeof r.jobTitle === 'string' ? (r.jobTitle as string).trim().slice(0, 200) : '';
            const notes = typeof r.notes === 'string' ? (r.notes as string).trim().slice(0, 5000) : '';
            const infoVaultType = typeof r.infoVaultType === 'string' ? (r.infoVaultType as string).trim() : '';
            const relationshipTypeRaw = typeof r.relationshipType === 'string' ? (r.relationshipType as string).trim() : 'other';
            const freqRaw = typeof r.contactFrequency === 'string' ? (r.contactFrequency as string).trim() : '';
            const allowedRel = ['myself', 'personal', 'professional', 'family', 'other'];
            const allowedFreq = ['', 'daily', 'weekly', 'monthly', 'yearly', 'rarely'];
            let relationshipType = 'other';
            if (allowedRel.includes(relationshipTypeRaw)) {
                relationshipType = relationshipTypeRaw;
            }
            let contactFrequency = '';
            if (allowedFreq.includes(freqRaw)) {
                contactFrequency = freqRaw;
            }
            let tags: string[] = [];
            if (Array.isArray(r.tags)) {
                tags = (r.tags as unknown[]).filter((t) => typeof t === 'string').map((t) => (t as string).trim()).filter((t) => t.length > 0).slice(0, 20);
            } else if (typeof r.tags === 'string') {
                tags = (r.tags as string).split(',').map((t) => t.trim()).filter((t) => t.length > 0).slice(0, 20);
            }
            const doc = await ModelInfoVault.create({
                userId: res.locals.auth_userId,
                name: nameRaw.slice(0, 200),
                company,
                jobTitle,
                notes,
                infoVaultType,
                relationshipType,
                contactFrequency,
                tags,
                isFavorite: false,
                isArchived: false,
                isBlocked: false,
                createdAtUtc: now,
                createdAtIpAddress: req.ip || '',
                createdAtUserAgent: req.headers['user-agent'] || '',
                updatedAtUtc: now,
                updatedAtIpAddress: req.ip || '',
                updatedAtUserAgent: req.headers['user-agent'] || '',
            });
            created.push((doc._id as mongoose.Types.ObjectId).toString());
        }
        return res.json({ message: 'Import completed', createdCount: created.length, createdIds: created });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/infoVaultBulkTag', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const ids = req.body?.ids;
        const tag = req.body?.tag;
        const action = req.body?.action;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids must be a non-empty array' });
        }
        if (typeof tag !== 'string' || tag.trim().length === 0) {
            return res.status(400).json({ message: 'tag must be a non-empty string' });
        }
        if (action !== 'add' && action !== 'remove') {
            return res.status(400).json({ message: 'action must be add or remove' });
        }
        const cleanTag = tag.trim().slice(0, 50);
        const objectIds: mongoose.Types.ObjectId[] = [];
        for (let i = 0; i < ids.length; i++) {
            const v = ids[i];
            if (typeof v === 'string' && v.length === 24) {
                try {
                    const oid = mongoose.Types.ObjectId.createFromHexString(v);
                    if (oid.toHexString().length === 24) {
                        objectIds.push(oid);
                    }
                } catch {
                }
            }
        }
        if (objectIds.length === 0) {
            return res.status(400).json({ message: 'no valid ids' });
        }
        let modified = 0;
        if (action === 'add') {
            const r = await ModelInfoVault.updateMany(
                { _id: { $in: objectIds }, userId: res.locals.auth_userId },
                { $addToSet: { tags: cleanTag }, $set: { updatedAtUtc: new Date(), updatedAtIpAddress: req.ip || '', updatedAtUserAgent: req.headers['user-agent'] || '' } }
            );
            modified = r.modifiedCount;
        } else {
            const r = await ModelInfoVault.updateMany(
                { _id: { $in: objectIds }, userId: res.locals.auth_userId },
                { $pull: { tags: cleanTag } as unknown as Record<string, unknown>, $set: { updatedAtUtc: new Date(), updatedAtIpAddress: req.ip || '', updatedAtUserAgent: req.headers['user-agent'] || '' } }
            );
            modified = r.modifiedCount;
        }
        return res.json({ message: 'Bulk tag completed', modifiedCount: modified });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router; 