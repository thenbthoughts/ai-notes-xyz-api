import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';

import { ModelChatLlmThread } from '../../../schema/SchemaChatLlmThread.schema';
import { ModelChatLlm } from '../../../schema/SchemaChatLlm.schema';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';

// Router
const router = Router();

// Get Note API
router.post('/threadsGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let tempStage = {} as PipelineStage;
        const stateDocument = [] as PipelineStage[];

        // stateDocument -> match
        tempStage = {
            $match: {
                username: res.locals.auth_username,
            }
        }
        stateDocument.push(tempStage);

        // stateDocument -> sort
        tempStage = {
            $sort: {
                createdAtUtc: -1,
            }
        }
        stateDocument.push(tempStage);

        // pipeline
        const resultNotes = await ModelChatLlmThread.aggregate(stateDocument);

        return res.json({
            message: 'Notes retrieved successfully',
            count: resultNotes.length,
            docs: resultNotes,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Note API
router.post('/threadsDeleteById', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // variable -> threadId
        let threadId = null as mongoose.Types.ObjectId | null;
        const arg_threadId = req.body.threadId;
        if (typeof req.body?.threadId === 'string') {
            threadId = req.body?.threadId ? mongoose.Types.ObjectId.createFromHexString(arg_threadId) : null;
        }
        if (threadId === null) {
            return res.status(400).json({ message: 'Thread ID cannot be null' });
        }

        const deletedThread = await ModelChatLlmThread.findOneAndDelete({
            _id: threadId,
            username: res.locals.auth_username
        });
        if (!deletedThread) {
            return res.status(404).json({ message: 'Thread not found' });
        }

        // delete all chat related to the thread
        await ModelChatLlm.deleteMany({
            threadId: threadId,
            username: res.locals.auth_username
        });

        return res.json({ message: 'Thread deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Create Thread API
router.post(
    '/threadsAdd',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);

            const threadTitle = actionDatetimeObj.createdAtUtc?.toUTCString() || new Date().toString();

            const newThread = await ModelChatLlmThread.create({
                // fields
                threadTitle: threadTitle.trim(),

                // auth
                username: res.locals.auth_username,

                // ai
                tagsAutoAi: [],
                aiSummary: '',
                aiTasks: [],

                // created at
                ...actionDatetimeObj,
            });

            console.log(newThread);

            return res.status(201).json({ message: 'Thread created successfully', thread: newThread });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Edit Thread API
router.post(
    '/threadsEditById',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);

            // variable -> threadId
            let threadId = null as mongoose.Types.ObjectId | null;
            const arg_threadId = req.body.threadId;
            if (typeof req.body?.threadId === 'string') {
                threadId = req.body?.threadId ? mongoose.Types.ObjectId.createFromHexString(arg_threadId) : null;
            }
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            // Extract fields to update
            const { threadTitle } = req.body;

            // Build update object
            const updateData: any = {};
            if (typeof threadTitle === 'string') {
                updateData.threadTitle = threadTitle
            };

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ message: 'No valid fields provided for update' });
            }

            // Update timestamps and user agent info
            const actionDatetimeUpdateObj = {
                updatedAtUtc: actionDatetimeObj.updatedAtUtc,
                updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress,
                updatedAtUserAgent: actionDatetimeObj.updatedAtUserAgent,
            };

            const updatedThread = await ModelChatLlmThread.findOneAndUpdate(
                { _id: threadId, username: res.locals.auth_username },
                {
                    $set: {
                        ...updateData,
                        ...actionDatetimeUpdateObj,
                    }
                },
                { new: true }
            );

            if (!updatedThread) {
                return res.status(404).json({ message: 'Thread not found or not authorized' });
            }

            return res.json({ message: 'Thread updated successfully', thread: updatedThread });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;