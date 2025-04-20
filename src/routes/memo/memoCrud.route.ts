import { Router, Request, Response } from 'express';
import mongoose, { FilterQuery, PipelineStage } from 'mongoose';
import { body } from 'express-validator';

import { ModelMemo } from '../../schema/SchemaMemoQuickAi.schema';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import middlewareExpressValidator from '../../middleware/middlewareExpressValidator';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';

// Router
const router = Router();

// Create Memo API
router.post(
    '/memoInsertOne',
    middlewareUserAuth,
    [
        body('title').custom((value) => {
            if (typeof value !== 'string') {
                throw new Error('title must be a string');
            }
            return true;
        }),
        body('content').custom((value) => {
            if (typeof value !== 'string') {
                throw new Error('content must be a string');
            }
            return true;
        }),
        body('color').custom((value) => {
            if (typeof value !== 'string') {
                throw new Error('color must be a string');
            }
            return true;
        }),
        body('labels').custom((value) => {
            if (!Array.isArray(value)) {
                throw new Error('labels must be an array');
            }
            return true;
        }),
        body('isPinned').custom((value) => {
            if (typeof value !== 'boolean') {
                throw new Error('isPinned must be a boolean');
            }
            return true;
        }),
        body('shouldSentToAI').custom((value) => {
            if (typeof value !== 'boolean') {
                throw new Error('shouldSentToAI must be a boolean');
            }
            return true;
        }),
    ],
    middlewareExpressValidator,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            // Destructure the request body to extract necessary fields for creating a new note
            const {
                title,
                content,
                color,
                labels,
                isPinned,
                shouldSentToAI,
            } = req.body;

            const actionDatetimeObj = normalizeDateTimeIpAddress(
                res.locals.actionDatetime
            );
            console.log(actionDatetimeObj);

            // Create a new note in the database using the extracted fields
            const newNote = await ModelMemo.create({
                // auth
                username: res.locals.auth_username,

                // note properties
                title,
                content,
                color,
                labels,
                labelsAi: [],
                isPinned,
                shouldSentToAI,

                // date time ip
                ...actionDatetimeObj,
            });

            // revalidate position
            await revalidateMemoPositionFunc({
                username: res.locals.auth_username,
            });

            // Respond with the newly created note and a 201 status code
            return res.status(201).json(newNote);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Get all Memos API
router.post(
    '/memoList',
    middlewareUserAuth,
    [
        body('recordId').custom((value) => {
            if (typeof value !== 'string') {
                throw new Error('recordId must be a string');
            }
            return true;
        }),
        body('searchQuery').custom((value) => {
            if (typeof value !== 'string') {
                throw new Error('searchQuery must be a string');
            }
            return true;
        }),
    ],
    middlewareExpressValidator,
    async (req: Request, res: Response) => {
        try {
            const username = res.locals.auth_username;
            const searchQuery: string = req.body.searchQuery.trim() || '';

            let recordId = '';
            if (typeof req.body.recordId === 'string') {
                if (mongoose.Types.ObjectId.isValid(req.body.recordId)) {
                    recordId = req.body.recordId;
                }
            }

            const stageDocument = [] as PipelineStage[];

            // match -> auth
            stageDocument.push({ $match: { username } });

            // match -> recordId
            if (recordId !== '') {
                stageDocument.push({
                    $match: {
                        _id: new mongoose.Types.ObjectId(recordId)
                    }
                });
            }

            // match -> searchQuery
            if (searchQuery !== '') {
                const matchOr = [] as FilterQuery<any>[];

                matchOr.push(
                    { title: { $regex: searchQuery, $options: 'i' } },
                    { content: { $regex: searchQuery, $options: 'i' } },
                    { labels: { $elemMatch: { $regex: searchQuery, $options: 'i' } } },
                    { labelsAi: { $elemMatch: { $regex: searchQuery, $options: 'i' } } }
                );

                stageDocument.push({
                    $match: {
                        $or: matchOr
                    }
                });
            }

            // Sort by position
            stageDocument.push({ $sort: { position: 1 } });

            const docs = await ModelMemo.aggregate(stageDocument);
            return res.json({
                success: '',
                error: '',
                data: {
                    count: docs.length,
                    docs: docs,
                }
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Update Memo API
router.post(
    '/memoUpdateById/:id',
    middlewareUserAuth,
    [
        body('title').custom((value) => {
            if (typeof value === 'undefined') {
                return true;
            }
            if (typeof value !== 'string') {
                throw new Error('title must be a string');
            }
            return true;
        }),
        body('content').custom((value) => {
            if (typeof value === 'undefined') {
                return true;
            }
            if (typeof value !== 'string') {
                throw new Error('content must be a string');
            }
            return true;
        }),
        body('color').custom((value) => {
            if (typeof value === 'undefined') {
                return true;
            }
            if (typeof value !== 'string') {
                throw new Error('color must be a string');
            }
            return true;
        }),
        body('labels').custom((value) => {
            if (typeof value === 'undefined') {
                return true;
            }
            if (!Array.isArray(value)) {
                throw new Error('labels must be an array');
            }
            return true;
        }),
        body('isPinned').custom((value) => {
            if (typeof value === 'undefined') {
                return true;
            }
            if (typeof value !== 'boolean') {
                throw new Error('isPinned must be a boolean');
            }
            return true;
        }),
        body('shouldSentToAI').custom((value) => {
            if (typeof value === 'undefined') {
                return true;
            }
            if (typeof value !== 'boolean') {
                throw new Error('shouldSentToAI must be a boolean');
            }
            return true;
        }),
    ],
    middlewareExpressValidator,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const actionDatetimeObj = normalizeDateTimeIpAddress(
                res.locals.actionDatetime
            );
            console.log(actionDatetimeObj);

            // Destructure the request body to extract necessary fields for creating a new note
            const {
                title,
                content,
                color,
                labels,
                isPinned,
                shouldSentToAI,
            } = req.body;

            const updateData = {
                title,
                content,
                color,
                labels,
                isPinned,
                shouldSentToAI,
            };

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ message: 'Error: updateData object length is 0' });
            }

            const updatedNote = await ModelMemo.findByIdAndUpdate(
                {
                    _id: req.params.id,
                    username: res.locals.auth_username
                },
                {
                    ...updateData,

                    // datetime ip
                    updatedAtUtc: actionDatetimeObj.updatedAtUtc,
                    updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress,
                    updatedAtUserAgent: actionDatetimeObj.updatedAtUserAgent,
                },
                {
                    new: true
                }
            );

            if (!updatedNote) {
                return res.status(404).json({ message: 'Memo not found' });
            }

            // revalidate position
            await revalidateMemoPositionFunc({
                username: res.locals.auth_username,
            });

            return res.status(200).json(updatedNote);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Delete Memo API
router.post('/memoDeleteById/:id', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username; // Add auth username
        const deletedNote = await ModelMemo.findOneAndDelete({
            _id: req.params.id,
            username
        });
        if (!deletedNote) {
            return res.status(404).json({ message: 'Memo not found' });
        }
        return res.json({ message: 'Memo deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

interface moveType {
    _id: string;
    moveType: "before" | "after" | "atPosition"
}

const revalidateMemoPositionFunc = async ({
    username,
}: {
    username: string;
}) => {
    try {
        // Revalidate: Bulk write to update positions that do not exist
        const allMemos = await ModelMemo.aggregate([
            { $match: { username } },
            {
                $addFields: {
                    isPinnedInt: {
                        $cond: {
                            if: {
                                $eq: ["$isPinned", true]
                            },
                            then: 1,
                            else: 0
                        }
                    }
                }
            },
            {
                $sort: {
                    isPinnedInt: -1,
                    position: 1,
                    _id: 1
                }
            }
        ]);

        const bulkOps = [];
        for (let index = 0; index < allMemos.length; index++) {
            const element = allMemos[index];
            if (element.position === index + 1) {
                // valid
            } else {
                bulkOps.push({
                    updateOne: {
                        filter: { _id: element._id },
                        update: { $set: { position: index + 1 } }
                    }
                });
            }
        }

        if (bulkOps.length > 0) {
            await ModelMemo.bulkWrite(bulkOps);
        }
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

router.post('/memoMovePosition', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username; // Add auth username


        const resultRevalidate = await revalidateMemoPositionFunc({
            username,
        });

        return res.status(200).json({
            success: 'revalidated memo position successfully',
            error: '',
            data: {
                resultRevalidate,
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});


export default router;