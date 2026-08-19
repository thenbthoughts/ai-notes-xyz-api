import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../../middleware/middlewareUserAuth';
import middlewareActionDatetime from '../../../../middleware/middlewareActionDatetime';
import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentOpencodeInstance } from '../../../../schema/schemaChatLlm/SchemaAgentOpencode/SchemaAgentOpencodeInstance.schema';
import { getMongodbObjectOrNull } from '../../../../utils/common/getMongodbObjectOrNull';
import agentOpencodeInitiate from './agentOpencodeInitiate';
import { serializeAgentOpencodeInstance } from './agentOpencodeSerialize';

const router = Router();

router.post(
    '/init',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;

            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const lastMessage = await ModelChatLlm.findOne({
                threadId,
                userId: auth_userId,
                isAi: false,
            }).sort({ createdAtUtc: -1 });
            if (!lastMessage) {
                return res.status(400).json({ message: 'Last message not found' });
            }

            const result = await agentOpencodeInitiate({
                messageId: lastMessage._id,
            });

            if (result.success === false) {
                return res.status(500).json({ message: 'Server error', error: result.errorReason });
            }

            return res.status(200).json({
                message: 'Success',
                agentOpencodeInstanceId: result.agentOpencodeInstanceId,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        }
    }
);

router.post(
    '/status',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const docs = await ModelAgentOpencodeInstance.find({
                threadId,
                userId: auth_userId,
            })
                .sort({ createdAtUtc: -1 })
                .limit(40)
                .lean();

            const instances = docs.map((doc, index) =>
                serializeAgentOpencodeInstance(doc, {
                    isLatest: index === 0,
                    promptLimit: 160,
                })
            );
            const latest = instances[0] || null;

            return res.status(200).json({
                success: true,
                status: latest?.status || null,
                agentOpencodeInstanceId: latest?.id || null,
                pipelineStep: latest?.pipelineStep || '',
                instances,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        }
    }
);

router.post(
    '/instance-list',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const docs = await ModelAgentOpencodeInstance.find({
                threadId,
                userId: auth_userId,
            })
                .sort({ createdAtUtc: -1 })
                .limit(40)
                .lean();

            return res.status(200).json({
                success: true,
                instances: docs.map((doc, index) =>
                    serializeAgentOpencodeInstance(doc, {
                        isLatest: index === 0,
                        promptLimit: 160,
                    })
                ),
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        }
    }
);

router.post(
    '/instance-by-id',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_userId = res.locals.auth_userId;
            const threadId = getMongodbObjectOrNull(req.body.threadId);
            const instanceId = getMongodbObjectOrNull(req.body.instanceId);
            if (threadId === null || instanceId === null) {
                return res.status(400).json({ message: 'Thread ID and instance ID are required' });
            }

            const doc = await ModelAgentOpencodeInstance.findOne({
                _id: instanceId,
                threadId,
                userId: auth_userId,
            }).lean();
            if (!doc) {
                return res.status(404).json({ message: 'Instance not found' });
            }

            let outputContent = '';
            if (doc.chatMessageId) {
                const chat = await ModelChatLlm.findById(doc.chatMessageId).select('content').lean();
                if (chat && typeof chat.content === 'string') {
                    outputContent = chat.content;
                }
            }

            const latest = await ModelAgentOpencodeInstance.findOne({
                threadId,
                userId: auth_userId,
            })
                .sort({ createdAtUtc: -1 })
                .select('_id')
                .lean();

            return res.status(200).json({
                success: true,
                instance: serializeAgentOpencodeInstance(doc, {
                    isLatest: latest ? String(latest._id) === String(doc._id) : false,
                    outputContent,
                }),
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error', error: error });
        }
    }
);

export default router;
