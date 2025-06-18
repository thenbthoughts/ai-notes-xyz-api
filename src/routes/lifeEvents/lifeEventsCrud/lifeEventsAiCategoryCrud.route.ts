import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { ModelLifeEventCategory } from '../../../schema/SchemaLifeEventsCategory.schema';
import { ModelLifeEvents } from '../../../schema/SchemaLifeEvents.schema';

const router = Router();

// Get Life Events Category
router.post('/lifeEventAiCategoryGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const lifeEvents = await ModelLifeEvents.aggregate([
            {
                $match: {
                    username: res.locals.auth_username,
                }
            },
            {
                $group: {
                    _id: {
                        aiCategory: "$aiCategory"
                    },
                    count: {
                        $sum: 1
                    }
                }
            },
            {
                $project: {
                    aiCategory: "$_id.aiCategory",
                    count: 1
                }
            },
            {
                $sort: {
                    aiCategory: 1,
                }
            }
        ]);

        return res.json({
            message: 'Life events retrieved successfully',
            docs: lifeEvents,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get Life Events Ai Sub Category
router.post('/lifeEventAiSubCategoryGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let aiCategory = '' as string;
        const arg_aiCategory = req.body.aiCategory;
        if (typeof arg_aiCategory === 'string') {
            if (arg_aiCategory.length > 0) {
                aiCategory = arg_aiCategory;
            }
        }

        const lifeEvents = await ModelLifeEvents.aggregate([
            {
                $match: {
                    username: res.locals.auth_username,
                    aiCategory: aiCategory,
                }
            },
            {
                $group: {
                    _id: {
                        aiSubCategory: "$aiSubCategory"
                    },
                    count: {
                        $sum: 1
                    }
                }
            },
            {
                $project: {
                    aiSubCategory: "$_id.aiSubCategory",
                    count: 1
                }
            },
            {
                $sort: {
                    aiSubCategory: 1,
                }
            }
        ]);

        return res.json({
            message: 'Life events retrieved successfully',
            docs: lifeEvents,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;