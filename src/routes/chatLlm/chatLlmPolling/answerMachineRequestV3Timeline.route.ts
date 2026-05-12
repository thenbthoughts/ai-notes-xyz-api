import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAnswerMachineRequestV3 } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV3.schema';
import {
    aggregateAnswerMachineRequestV3UnionThread,
    type AnswerMachineRequestV3UnionThreadItem,
} from '../chatLlmCrud/utils/answerMachineRequestV3UnionThreadAggregate';

export type { AnswerMachineRequestV3UnionThreadItem };

const router = Router();

/** Optional: same union as notesGet — kept for callers that don’t load notes. */
router.post(
    '/answerMachineRequestV3UnionThread',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const username = res.locals.auth_username as string;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const thread = await ModelChatLlmThread.findOne({
                _id: threadId,
                username,
            }).select('_id');
            if (!thread) {
                return res.status(404).json({ message: 'Thread not found' });
            }

            const items = await aggregateAnswerMachineRequestV3UnionThread({ username, threadId });
            return res.status(200).json({ items });
        } catch (error) {
            console.error('answerMachineRequestV3UnionThread:', error);
            return res.status(500).json({
                message: 'Server error',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
);

/** Poll Answer Machine V3 requests for a thread (no union). */
router.post(
    '/answerMachineRequestV3List',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const username = res.locals.auth_username as string;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const thread = await ModelChatLlmThread.findOne({
                _id: threadId,
                username,
            }).select('_id answerEngine');
            if (!thread) {
                return res.status(404).json({ message: 'Thread not found' });
            }

            const docs = await ModelAnswerMachineRequestV3.find({
                threadId,
                username,
            })
                .sort({ createdAt: -1 })
                .select({
                    _id: 1,
                    parentMessageId: 1,
                    status: 1,
                    errorReason: 1,
                    currentIteration: 1,
                    maxNumberOfIterations: 1,
                    totalTokens: 1,
                    costInUsd: 1,
                    createdAt: 1,
                    updatedAt: 1,
                })
                .lean();

            const requests = docs.map((r) => ({
                _id: String(r._id),
                parentMessageId: String(r.parentMessageId),
                status: r.status,
                errorReason: (r.errorReason || '').slice(0, 500),
                currentIteration: r.currentIteration,
                maxNumberOfIterations: r.maxNumberOfIterations,
                totalTokens: r.totalTokens ?? 0,
                costInUsd: r.costInUsd ?? 0,
                createdAt: new Date(r.createdAt).toISOString(),
                updatedAt: new Date(r.updatedAt).toISOString(),
            }));

            return res.status(200).json({
                answerEngine: thread.answerEngine,
                requests,
            });
        } catch (error) {
            console.error('answerMachineRequestV3List:', error);
            return res.status(500).json({
                message: 'Server error',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
);

export default router;
