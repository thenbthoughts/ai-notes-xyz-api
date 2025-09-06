import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { ModelLifeEvents } from '../../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelLlmPendingTaskCron } from '../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../../utils/llmPendingTask/llmPendingTaskConstants';

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
                username: res.locals.auth_username,
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

                const matchAnd = [];
                for (let index = 0; index < searchQueryArr.length; index++) {
                    const elementStr = searchQueryArr[index];
                    matchAnd.push({
                        $or: [
                            { title: { $regex: elementStr, $options: 'i' } },
                            { description: { $regex: elementStr, $options: 'i' } },
                            { aiSummary: { $regex: elementStr, $options: 'i' } },
                            { aiTags: { $regex: elementStr, $options: 'i' } },
                            { aiSuggestions: { $regex: elementStr, $options: 'i' } },
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
            }
        }

        // sort
        tempStage = {
            $sort: {
                eventDateUtc: 1,
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

        // stage -> lookup -> files list
        tempStage = {
            $lookup: {
                from: 'lifeEventsFileUpload',
                localField: '_id',
                foreignField: 'lifeEventId',
                as: 'filesArr',
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
            username: res.locals.auth_username,
        });

        if (!lifeEvent) {
            return res.status(404).json({ message: 'Life event not found or unauthorized' });
        }

        return res.json({ message: 'Life event deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Life Event API
router.post('/lifeEventsAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const eventDateUtc = new Date();
        const year = eventDateUtc.getUTCFullYear();
        const month = (eventDateUtc.getUTCMonth() + 1).toString().padStart(2, '0');
        const eventDateYearStr = `${year}-${month}`;
        const eventDateYearMonthStr = `${year}-${month}`;

        const newLifeEvent = await ModelLifeEvents.create({
            eventDateUtc,
            eventDateYearStr,
            eventDateYearMonthStr,

            username: res.locals.auth_username,
            title: `Empty Event - ${eventDateUtc.toDateString()} ${eventDateUtc.toLocaleTimeString().substring(0, 7)}`,

            aiTags: ['Empty event'],
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
router.post('/lifeEventsEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'Life event ID cannot be null' });
        }

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
                    username: res.locals.auth_username,
                },
                {
                    $set: {
                        ...updateObj,
                    }
                }
            );
            console.log(newLifeEvent);
        }

        // generate ai tags by id
        await ModelLlmPendingTaskCron.create({
            username: res.locals.auth_username,
            taskType: llmPendingTaskTypes.page.lifeEvents.generateLifeEventAiTagsById,
            targetRecordId: _id,
        });

        // generate ai summary by id
        await ModelLlmPendingTaskCron.create({
            username: res.locals.auth_username,
            taskType: llmPendingTaskTypes.page.lifeEvents.generateLifeEventAiSummaryById,
            targetRecordId: _id,
        });

        // generate ai category by id
        await ModelLlmPendingTaskCron.create({
            username: res.locals.auth_username,
            taskType: llmPendingTaskTypes.page.lifeEvents.generateLifeEventAiCategoryById,
            targetRecordId: _id,
        });

        return res.json({
            message: 'Life event edited successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;