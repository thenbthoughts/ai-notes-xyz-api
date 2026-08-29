import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { ModelLifeEvents } from '../../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelLlmPendingTaskCron } from '../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../../utils/llmPendingTask/llmPendingTaskConstants';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';
import { reindexDocument } from '../../../utils/search/reindexGlobalSearch';
import { deleteFilesByParentEntityId } from '../../upload/uploadFileS3ForFeatures';

const router = Router();

// Get Life Events API
router.post('/lifeEventsGet', middlewareUserAuth, async (req: Request, res: Response) => {
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

        // stage -> match -> lifeEventId
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

        // stage -> match -> category
        const arg_categoryId = req.body.categoryId;
        if (typeof arg_categoryId === 'string') {
            if (arg_categoryId.length === 24) {
                let categoryId = null as mongoose.Types.ObjectId | null;
                categoryId = arg_categoryId ? mongoose.Types.ObjectId.createFromHexString(arg_categoryId) : null;
                if (categoryId) {
                    if (categoryId.toHexString().length === 24) {
                        tempStage = { $match: { categoryId: categoryId } };
                        pipelineDocument.push(tempStage);
                        pipelineCount.push(tempStage);
                    }
                }
            }
        }

        // stage -> match -> category
        const arg_categorySubId = req.body.categorySubId;
        if (typeof arg_categorySubId === 'string') {
            if (arg_categorySubId.length === 24) {
                let categorySubId = null as mongoose.Types.ObjectId | null;
                categorySubId = arg_categorySubId ? mongoose.Types.ObjectId.createFromHexString(arg_categorySubId) : null;
                if (categorySubId) {
                    if (categorySubId.toHexString().length === 24) {
                        tempStage = { $match: { categorySubId: categorySubId } };
                        pipelineDocument.push(tempStage);
                        pipelineCount.push(tempStage);
                    }
                }
            }
        }

        // stage -> match -> aiCategory
        const arg_aiCategory = req.body.aiCategory;
        if (typeof arg_aiCategory === 'string') {
            if (arg_aiCategory.length >= 1) {
                tempStage = { $match: { aiCategory: arg_aiCategory } };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> match -> aiSubCategory
        const arg_aiSubCategory = req.body.aiSubCategory;
        if (typeof arg_aiSubCategory === 'string') {
            if (arg_aiSubCategory.length >= 1) {
                tempStage = { $match: { aiSubCategory: arg_aiSubCategory } };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> match -> titleExact
        const arg_titleExact = req.body.titleExact;
        if (typeof arg_titleExact === 'string') {
            if (arg_titleExact.length >= 1) {
                tempStage = { $match: { title: arg_titleExact } };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> match -> isStar
        if (typeof req.body?.isStar === 'string') {
            if (
                req.body?.isStar === 'true' ||
                req.body?.isStar === 'false'
            ) {
                const isStar = req.body?.isStar === 'true';
                tempStage = {
                    $match: {
                        isStar: isStar,
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> match -> eventImpact
        if (typeof req.body?.eventImpact === 'string') {
            if (
                [
                    'very-low',
                    'low',
                    'medium',
                    'large',
                    'huge'
                ].includes(req.body.eventImpact)
            ) {
                const eventImpact = req.body.eventImpact;
                tempStage = {
                    $match: {
                        eventImpact: eventImpact,
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> match -> hideDailyDiary
        if (typeof req.body?.hideDailyDiary === 'boolean') {
            if (req.body.hideDailyDiary === true) {
                tempStage = {
                    $match: {
                        title: {
                            $not: {
                                $regex: '(Daily|Weekly|Monthly) Summary by AI',
                                $options: 'i',
                            }
                        }
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        if (typeof req.body?.isArchived === 'string') {
            if (req.body.isArchived === 'true' || req.body.isArchived === 'false') {
                const isArchived = req.body.isArchived === 'true';
                tempStage = { $match: { isArchived } };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        } else if (typeof req.body?.isArchived === 'boolean') {
            tempStage = { $match: { isArchived: req.body.isArchived } };
            pipelineDocument.push(tempStage);
            pipelineCount.push(tempStage);
        }

        if (typeof req.body?.startDate === 'string' && typeof req.body?.endDate === 'string') {
            let startDateUtc = `${req.body.startDate}`;
            let endDateUtc = `${req.body.endDate}`;
            if (startDateUtc.length >= 24 && endDateUtc.length >= 24) {
                tempStage = {
                    $match: {
                        eventDateUtc: {
                            $gte: new Date(startDateUtc),
                            $lte: new Date(endDateUtc),
                        },
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
                            // life event
                            { title: { $regex: elementStr, $options: 'i' } },
                            { description: { $regex: elementStr, $options: 'i' } },
                            { aiSummary: { $regex: elementStr, $options: 'i' } },
                            { aiTags: { $regex: elementStr, $options: 'i' } },
                            { aiSuggestions: { $regex: elementStr, $options: 'i' } },

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

        // sort
        tempStage = {
            $sort: {
                eventDateUtc: -1,
            }
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

        // stage -> lookup -> category
        tempStage = {
            $lookup: {
                from: 'lifeEventCategory',
                localField: 'categoryId',
                foreignField: '_id',
                as: 'categoryArr',
            }
        };
        pipelineDocument.push(tempStage);

        // stage -> lookup -> sub category
        tempStage = {
            $lookup: {
                from: 'lifeEventCategory',
                localField: 'categorySubId',
                foreignField: '_id',
                as: 'categorySubArr',
            }
        };
        pipelineDocument.push(tempStage);

        // stage -> comments
        tempStage = {
            $lookup: {
                from: 'commentsCommon',
                let: { entityId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$entityId', '$$entityId'] },
                                    { $eq: ['$userId', res.locals.auth_userId] }
                                ]
                            }
                        }
                    }
                ],
                as: 'comments',
            }
        };
        pipelineDocument.push(tempStage);

        // stageCount -> count
        pipelineCount.push({
            $count: 'count'
        });

        const lifeEvents = await ModelLifeEvents.aggregate(pipelineDocument);

        const lifeEventsCount = await ModelLifeEvents.aggregate(pipelineCount);

        let totalCount = 0;
        if (lifeEventsCount.length === 1) {
            if (lifeEventsCount[0].count) {
                totalCount = lifeEventsCount[0].count;
            }
        }

        return res.json({
            message: 'Life events retrieved successfully',
            count: totalCount,
            docs: lifeEvents,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Life Event API
router.post('/lifeEventsDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'Life event ID cannot be null' });
        }

        const lifeEvent = await ModelLifeEvents.findOneAndDelete({
            _id: _id,
            userId: res.locals.auth_userId,
        });

        if (!lifeEvent) {
            return res.status(404).json({ message: 'Life event not found or unauthorized' });
        }

        // delete files from s3
        await deleteFilesByParentEntityId({
            userId: res.locals.auth_userId,
            parentEntityId: _id.toString(),
        });

        return res.json({ message: 'Life event deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Life Event API
router.post('/lifeEventsAdd', middlewareUserAuth, middlewareActionDatetime, async (req: Request, res: Response) => {
    try {
        const eventDateUtc = new Date();
        const year = eventDateUtc.getUTCFullYear();
        const month = (eventDateUtc.getUTCMonth() + 1).toString().padStart(2, '0');
        const eventDateYearStr = `${year}-${month}`;
        const eventDateYearMonthStr = `${year}-${month}`;

        const actionDatetimeObj = normalizeDateTimeIpAddress(
            res.locals.actionDatetime
        );

        const newLifeEvent = await ModelLifeEvents.create({
            eventDateUtc,
            eventDateYearStr,
            eventDateYearMonthStr,

            userId: res.locals.auth_userId,
            title: `Empty Event - ${eventDateUtc.toDateString()} ${eventDateUtc.toLocaleTimeString().substring(0, 7)}`,

            aiTags: ['Empty event'],

            ...actionDatetimeObj,
        });

        // generate Feature AI Actions by source id
        await ModelLlmPendingTaskCron.create({
            userId: res.locals.auth_userId,
            taskType: llmPendingTaskTypes.page.featureAiActions.lifeEvents,
            targetRecordId: newLifeEvent._id,
        });

        // reindex for global search
        await reindexDocument({
            reindexDocumentArr: [{
                collectionName: 'lifeEvents',
                documentId: (newLifeEvent._id as mongoose.Types.ObjectId).toString(),
            }],
        });

        return res.json({
            message: 'Life event added successfully',
            doc: newLifeEvent,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Edit Life Event API
router.post('/lifeEventsEdit', middlewareUserAuth, middlewareActionDatetime, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'Life event ID cannot be null' });
        }

        const actionDatetimeObj = normalizeDateTimeIpAddress(
            res.locals.actionDatetime
        );

        const updateObj = {

        } as {
            title?: string;
            description?: string;
            categoryId?: mongoose.Types.ObjectId | null;
            categorySubId?: mongoose.Types.ObjectId | null;
            isStar?: boolean;
            eventImpact?: string;
            eventDateUtc?: Date;
        };

        if (typeof req.body.title === 'string') {
            updateObj.title = req.body.title;
        }
        if (typeof req.body.description === 'string') {
            updateObj.description = req.body.description;
        }
        if (typeof req.body.categoryId === 'string') {
            const arg_categoryId = req.body.categoryId;
            let categoryId = arg_categoryId ? mongoose.Types.ObjectId.createFromHexString(arg_categoryId) : null;
            updateObj.categoryId = categoryId;
        }
        if (typeof req.body.categorySubId === 'string') {
            updateObj.categorySubId = req.body.categorySubId;
        }
        if (typeof req.body.isStar === 'boolean') {
            updateObj.isStar = req.body.isStar;
        }
        if (typeof req.body.eventImpact === 'string') {
            updateObj.eventImpact = req.body.eventImpact;
        }
        if (typeof req.body.placeName === 'string') {
            (updateObj as Record<string, unknown>).placeName = req.body.placeName;
        }
        if (typeof req.body.address === 'string') {
            (updateObj as Record<string, unknown>).address = req.body.address;
        }
        if (req.body.lat === null || typeof req.body.lat === 'number') {
            (updateObj as Record<string, unknown>).lat = req.body.lat;
        }
        if (req.body.lng === null || typeof req.body.lng === 'number') {
            (updateObj as Record<string, unknown>).lng = req.body.lng;
        }
        if (typeof req.body.isArchived === 'boolean') {
            (updateObj as Record<string, unknown>).isArchived = req.body.isArchived;
        }
        if (typeof req.body.aiSummary === 'string') {
            (updateObj as Record<string, unknown>).aiSummary = req.body.aiSummary;
        }
        if (req.body.eventDateUtc) {
            const date = new Date(req.body.eventDateUtc);
            if (!isNaN(date.getTime())) {
                updateObj.eventDateUtc = date;
            }
            // if (typeof req.body.eventDateYearStr === 'string') {
            //     updateObj.eventDateYearStr = req.body.eventDateYearStr;
            // }
            // if (typeof req.body.eventDateYearMonthStr === 'string') {
            //     updateObj.eventDateYearMonthStr = req.body.eventDateYearMonthStr;
            // }
        }

        if (Object.keys(updateObj).length >= 1) {
            const newLifeEvent = await ModelLifeEvents.updateOne(
                {
                    _id: _id,
                    userId: res.locals.auth_userId,
                },
                {
                    $set: {
                        ...updateObj,

                        // updated datetime ip
                        updatedAtUtc: actionDatetimeObj.updatedAtUtc,
                        updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress,
                        updatedAtUserAgent: actionDatetimeObj.updatedAtUserAgent,
                    }
                }
            );
            console.log(newLifeEvent);
        }

        // generate Feature AI Actions by source id
        await ModelLlmPendingTaskCron.create({
            userId: res.locals.auth_userId,
            taskType: llmPendingTaskTypes.page.featureAiActions.lifeEvents,
            targetRecordId: _id,
        });

        // reindex for global search
        await reindexDocument({
            reindexDocumentArr: [{
                collectionName: 'lifeEvents',
                documentId: _id.toString(),
            }],
        });

        return res.json({
            message: 'Life event edited successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/lifeEventsBulkDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids : [];
        const valid = ids.filter((id) => typeof id === 'string' && id.length === 24).map((id) => mongoose.Types.ObjectId.createFromHexString(id));
        if (valid.length === 0) return res.status(400).json({ message: 'No valid ids' });
        await ModelLifeEvents.deleteMany({ _id: { $in: valid }, userId: res.locals.auth_userId });
        return res.json({ message: 'Bulk deleted', count: valid.length });
    } catch (e) { console.error(e); return res.status(500).json({ message: 'Server error' }); }
});

router.post('/lifeEventsBulkArchive', middlewareUserAuth, middlewareActionDatetime, async (req: Request, res: Response) => {
    try {
        const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids : [];
        const isArchived = req.body.isArchived === true;
        const valid = ids.filter((id) => typeof id === 'string' && id.length === 24).map((id) => mongoose.Types.ObjectId.createFromHexString(id));
        if (valid.length === 0) return res.status(400).json({ message: 'No valid ids' });
        const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);
        await ModelLifeEvents.updateMany({ _id: { $in: valid }, userId: res.locals.auth_userId }, { $set: { isArchived, updatedAtUtc: actionDatetimeObj.updatedAtUtc, updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress, updatedAtUserAgent: actionDatetimeObj.updatedAtUserAgent } });
        return res.json({ message: 'Bulk archived', count: valid.length });
    } catch (e) { console.error(e); return res.status(500).json({ message: 'Server error' }); }
});

router.post('/lifeEventsStreak', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const docs = await ModelLifeEvents.find({ userId: res.locals.auth_userId }, { eventDateUtc: 1 }).sort({ eventDateUtc: 1 }).lean();
        const dateSet = new Set<string>();
        docs.forEach((d) => {
            const dt = d.eventDateUtc ? new Date(d.eventDateUtc as unknown as string) : null;
            if (dt && !isNaN(dt.getTime())) {
                const key = dt.toISOString().slice(0, 10);
                dateSet.add(key);
            }
        });
        const sorted = [...dateSet].sort();
        let longest = 0;
        let cur = 0;
        let prev: Date | null = null;
        sorted.forEach((s) => {
            const d = new Date(s);
            if (prev) {
                const diff = (d.getTime() - prev.getTime()) / 86400000;
                if (diff === 1) cur += 1;
                else cur = 1;
            } else cur = 1;
            if (cur > longest) longest = cur;
            prev = d;
        });
        let currentStreak = 0;
        if (sorted.length > 0) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            let cursor = new Date(today);
            const set = dateSet;
            while (true) {
                const k = cursor.toISOString().slice(0, 10);
                if (set.has(k)) { currentStreak += 1; cursor.setDate(cursor.getDate() - 1); }
                else break;
                if (currentStreak > 365) break;
            }
        }
        const total = docs.length;
        const thisMonth = docs.filter((d) => {
            const dt = d.eventDateUtc ? new Date(d.eventDateUtc as unknown as string) : null;
            if (!dt) return false;
            const now = new Date();
            return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
        }).length;
        return res.json({ total, thisMonth, currentStreak, longestStreak: longest, distinctDays: sorted.length });
    } catch (e) { console.error(e); return res.status(500).json({ message: 'Server error' }); }
});

export default router;