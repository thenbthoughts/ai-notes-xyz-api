import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';

import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';

// Router
const router = Router();

// Get Note API
router.post('/threadsGet', middlewareUserAuth, async (req: Request, res: Response) => {
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

        let tempStage = {} as PipelineStage;
        const stateDocument = [] as PipelineStage[];
        const stateCount = [] as PipelineStage[];

        // stateDocument -> match
        tempStage = {
            $match: {
                username: res.locals.auth_username,
            }
        }
        stateDocument.push(tempStage);
        stateCount.push(tempStage);

        // stateDocument -> match -> search
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
                            { threadTitle: { $regex: elementStr, $options: 'i' } },
                            { tagsAi: { $regex: elementStr, $options: 'i' } },
                            { aiSummary: { $regex: elementStr, $options: 'i' } },
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
                stateDocument.push(tempStage);
                stateCount.push(tempStage);
            }
        }

        // stateDocument -> match -> _id
        let threadId = null as mongoose.Types.ObjectId | null;
        const arg_threadId = req.body.threadId;
        if (typeof req.body?.threadId === 'string') {
            threadId = req.body?.threadId ? mongoose.Types.ObjectId.createFromHexString(arg_threadId) : null;
        }
        if (threadId !== null) {
            tempStage = {
                $match: {
                    _id: threadId,
                }
            }
            stateDocument.push(tempStage);
        }

        // stateDocument -> sort
        tempStage = {
            $sort: {
                createdAtUtc: -1,
            }
        }
        stateDocument.push(tempStage);
        stateCount.push(tempStage);

        // stage -> skip
        tempStage = {
            $skip: (page - 1) * perPage,
        };
        stateDocument.push(tempStage);

        // stage -> limit
        tempStage = {
            $limit: perPage,
        };
        stateDocument.push(tempStage);

        // stateCount -> count
        stateCount.push({
            $count: 'count'
        });

        // pipeline
        const resultThreads = await ModelChatLlmThread.aggregate(stateDocument);
        const resultCount = await ModelChatLlmThread.aggregate(stateCount);

        let totalCount = 0;
        if (resultCount.length === 1) {
            if (resultCount[0].count) {
                totalCount = resultCount[0].count;
            }
        }

        return res.json({
            message: 'Chat LLM Threads retrieved successfully',
            docs: resultThreads,
            count: totalCount,
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

            const {
                isAutoAiContextSelectEnabled,
                isPersonalContextEnabled,

                // model settings
                aiModelName,
                aiModelProvider,
            } = req.body;

            const addData = {
                threadTitle: threadTitle.trim(),
                isAutoAiContextSelectEnabled: false,
                isPersonalContextEnabled: false,

                // model settings
                aiModelName: '',
                aiModelProvider: '',
            };

            if (typeof isAutoAiContextSelectEnabled === 'boolean') {
                addData.isAutoAiContextSelectEnabled = isAutoAiContextSelectEnabled;
            };

            if (typeof isPersonalContextEnabled === 'boolean') {
                addData.isPersonalContextEnabled = isPersonalContextEnabled;
            };

            if (typeof aiModelName === 'string') {
                addData.aiModelName = aiModelName;
            };

            if (typeof aiModelProvider === 'string') {
                addData.aiModelProvider = aiModelProvider;
            };

            const newThread = await ModelChatLlmThread.create({
                // fields
                ...addData,

                // auth
                username: res.locals.auth_username,

                // created at
                ...actionDatetimeObj,
            });

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
            const {
                threadTitle,
                isAutoAiContextSelectEnabled,
                isPersonalContextEnabled,

                // model settings
                aiModelName,
                aiModelProvider,
            } = req.body;

            // Build update object
            const updateData: any = {};
            if (typeof threadTitle === 'string') {
                updateData.threadTitle = threadTitle
            };

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ message: 'No valid fields provided for update' });
            }

            if (typeof isAutoAiContextSelectEnabled === 'boolean') {
                updateData.isAutoAiContextSelectEnabled = isAutoAiContextSelectEnabled;
            };

            if (typeof isPersonalContextEnabled === 'boolean') {
                updateData.isPersonalContextEnabled = isPersonalContextEnabled;
            };

            if (typeof aiModelName === 'string') {
                updateData.aiModelName = aiModelName;
            };

            if (typeof aiModelProvider === 'string') {
                updateData.aiModelProvider = aiModelProvider;
            };

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