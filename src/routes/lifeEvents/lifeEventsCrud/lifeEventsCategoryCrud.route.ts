import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { ModelLifeEventCategory } from '../../../schema/SchemaLifeEventsCategory.schema';
import { ILifeEventCategory } from '../../../types/typesSchema/SchemaLifeEventCategory.types';

const router = Router();

// Get Life Events API
router.post('/lifeEventCategoryGet', middlewareUserAuth, async (req: Request, res: Response) => {
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
                            { categoryUniqueKey: { $regex: elementStr, $options: 'i' } },
                            { categorySubUniqueKey: { $regex: elementStr, $options: 'i' } },
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
                console.log(JSON.stringify([
                    tempStage,
                ]))
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

        tempStage = {
            $lookup: {
                from: 'lifeEventCategory',
                localField: '_id',
                foreignField: 'parentId',
                as: 'subcategories',
            }
        };
        pipelineDocument.push(tempStage);

        // stageCount -> count
        pipelineCount.push({
            $count: 'count'
        });

        const lifeEvents = await ModelLifeEventCategory.aggregate(pipelineDocument);

        const lifeEventsCount = await ModelLifeEventCategory.aggregate(pipelineCount);

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
router.post('/lifeEventCategoryDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'Life event ID cannot be null' });
        }

        const lifeEvent = await ModelLifeEventCategory.findOneAndDelete({
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
router.post('/lifeEventCategoryAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;

        const {
            name,
            isSubCategory,
        } = req.body;

        if (typeof name !== 'string') {
            return res.status(400).json({ error: 'Name must be a string' });
        }
        if (typeof isSubCategory !== 'boolean') {
            return res.status(400).json({ error: 'isSubCategory must be a boolean' });
        }

        let parentId = null as mongoose.Types.ObjectId | null;
        if (isSubCategory) {
            const arg_parentId = req.body.parentId;
            if (typeof req.body?.parentId === 'string') {
                parentId = req.body?.parentId ? mongoose.Types.ObjectId.createFromHexString(arg_parentId) : null;
            }
            if (parentId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }
        }

        if (isSubCategory === false) {
            // does parent exist
            const resultCategory = await ModelLifeEventCategory.findOne({
                name,
            }) as ILifeEventCategory;
            if (resultCategory) {
                return res.status(400).json({
                    error: 'Category exist',
                });
            }

            const newLifeEvent = await ModelLifeEventCategory.create({
                username: auth_username,

                name,
                isSubCategory,
                parentId: null,
            });

            return res.json({
                success: 'Life event added successfully',
                error: '',
                doc: newLifeEvent,
            });
        } else {
            console.log('parentId: ', parentId);
            // does parent exist
            const resultCategory = await ModelLifeEventCategory.findOne({
                parentId,
                name,
            }) as ILifeEventCategory;
            if (resultCategory) {
                return res.status(400).json({ error: 'Category exist' });
            }

            const newLifeEvent = await ModelLifeEventCategory.create({
                username: auth_username,

                name,
                isSubCategory,
                parentId,
            });

            return res.json({
                success: 'Life event added successfully',
                error: '',
                doc: newLifeEvent,
            });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Server error. Please try again.' });
    }
});

// Edit Life Event API
router.post('/lifeEventCategoryEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const auth_username = res.locals.auth_username;

        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'Life event ID cannot be null' });
        }

        const {
            name
        } = req.body;

        if (typeof name !== 'string' || name?.trim().length <= 0) {
            return res.status(400).json({ error: 'Name cannot be empty' });
        }

        const result = await ModelLifeEventCategory.findOne({
            _id: _id,
            username: auth_username,
        }) as ILifeEventCategory;
        if (!result) {
            return res.status(400).json({ error: 'Record does not exist' });
        }

        if (result.isSubCategory === false) {
            // does parent exist
            const resultCategory = await ModelLifeEventCategory.findOne({
                name,
            }) as ILifeEventCategory;
            if (resultCategory) {
                return res.status(400).json({
                    error: 'Category exist',
                });
            }
        } else {
            // does parent exist
            const resultCategory = await ModelLifeEventCategory.findOne({
                parentId: result.parentId,
                name,
            }) as ILifeEventCategory;
            if (resultCategory) {
                return res.status(400).json({ error: 'Category exist' });
            }
        }

        const newLifeEvent = await ModelLifeEventCategory.updateOne(
            {
                _id: _id,
                username: res.locals.auth_username,
            },
            {
                $set: {
                    name: name,
                }
            }
        );
        console.log(newLifeEvent);

        return res.json({
            message: 'Life event category edited successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;