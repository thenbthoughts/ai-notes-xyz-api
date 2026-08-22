import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

import middlewareWebhookAuth from './webhookAuth.middleware';
import {
    parseWebhookSearchSource,
    webhookSearchAll,
    webhookSearchSource,
} from './webhookSearch';
import { WEBHOOK_ENDPOINTS } from '../../utils/webhook/webhookContext';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';
import { getApiKeyByObject, type tsUserApiKey } from '../../utils/llm/llmCommonFunc';
import {
    attachFileToChatMessage,
    collectMessageFileUrls,
} from '../../utils/chat/attachFileToChatMessage';
import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { ModelChatLlm } from '../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelUserFileUpload } from '../../schema/schemaUser/SchemaUserFileUpload.schema';

const router = Router();

const queryText = (body: Record<string, unknown>, query: Request['query']): string => {
    if (typeof body.query === 'string') return body.query;
    if (typeof query.q === 'string') return query.q;
    if (typeof query.query === 'string') return query.query;
    return '';
};

const userIdFrom = (res: Response): mongoose.Types.ObjectId =>
    res.locals.auth_userId as mongoose.Types.ObjectId;

const apiKeysFrom = (res: Response): tsUserApiKey => getApiKeyByObject(res.locals.apiKey);

const bodyId = (body: Record<string, unknown>): string | null => {
    if (typeof body.id === 'string') return body.id;
    if (typeof body._id === 'string') return body._id;
    if (typeof body.messageId === 'string') return body.messageId;
    return null;
};

router.use(middlewareWebhookAuth);

router.get('/about', async (_req: Request, res: Response) => {
    return res.json({
        success: true,
        name: 'ai-notes-xyz-webhook',
        endpoints: WEBHOOK_ENDPOINTS.map((ep) => ({
            method: ep.method,
            path: `/api/webhook${ep.path}`,
            description: ep.desc,
        })),
    });
});

router.post('/search', async (req: Request, res: Response) => {
    try {
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const query = queryText(body, req.query);
        const source = parseWebhookSearchSource(body.source ?? req.query.source);
        const userId = userIdFrom(res);
        const items =
            source === 'all'
                ? await webhookSearchAll({ userId, query })
                : await webhookSearchSource({ userId, source, query });
        return res.json({ success: true, query, source, count: items.length, items });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

const searchOneSource =
    (source: 'notes' | 'tasks' | 'lifeEvents' | 'memo' | 'infoVault') =>
    async (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
            const query = queryText(body, req.query);
            const items = await webhookSearchSource({
                userId: userIdFrom(res),
                source,
                query,
            });
            return res.json({ success: true, query, source, count: items.length, items });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    };

router.post('/notes/search', searchOneSource('notes'));
router.post('/tasks/search', searchOneSource('tasks'));
router.post('/life-events/search', searchOneSource('lifeEvents'));
router.post('/memo/search', searchOneSource('memo'));
router.post('/info-vault/search', searchOneSource('infoVault'));

router.post('/notes/get', async (req: Request, res: Response) => {
    try {
        const id = getMongodbObjectOrNull(
            typeof req.body?.id === 'string' ? req.body.id : typeof req.body?._id === 'string' ? req.body._id : null
        );
        if (!id) return res.status(400).json({ message: 'id is required' });
        const doc = await ModelNotes.findOne({ _id: id, userId: userIdFrom(res) }).lean();
        if (!doc) return res.status(404).json({ message: 'Note not found' });
        return res.json({ success: true, item: doc });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/tasks/get', async (req: Request, res: Response) => {
    try {
        const id = getMongodbObjectOrNull(
            typeof req.body?.id === 'string' ? req.body.id : typeof req.body?._id === 'string' ? req.body._id : null
        );
        if (!id) return res.status(400).json({ message: 'id is required' });
        const doc = await ModelTask.findOne({ _id: id, userId: userIdFrom(res) }).lean();
        if (!doc) return res.status(404).json({ message: 'Task not found' });
        return res.json({ success: true, item: doc });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/files/list', async (req: Request, res: Response) => {
    try {
        const userId = userIdFrom(res);
        const messageId = getMongodbObjectOrNull(bodyId((req.body || {}) as Record<string, unknown>));
        if (!messageId) return res.status(400).json({ message: 'messageId is required' });
        const msg = await ModelChatLlm.findOne({ _id: messageId, userId }).lean();
        if (!msg) return res.status(404).json({ message: 'Chat message not found' });
        const urls = collectMessageFileUrls(msg);
        const docs = urls.length
            ? await ModelUserFileUpload.find({
                  userId,
                  fileUploadPath: { $in: urls },
              })
                  .select('_id originalName fileUploadPath contentType size parentEntityId')
                  .lean()
            : [];
        const byPath = new Map(docs.map((d) => [d.fileUploadPath, d]));
        return res.json({
            success: true,
            messageId: String(msg._id),
            count: urls.length,
            items: urls.map((fileUploadPath) => {
                const d = byPath.get(fileUploadPath);
                return {
                    fileUploadPath,
                    originalName: d?.originalName || fileUploadPath.split('/').pop() || '',
                    contentType: d?.contentType || '',
                    size: d?.size || 0,
                    id: d?._id ? String(d._id) : '',
                };
            }),
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/files/add', async (req: Request, res: Response) => {
    try {
        const result = await attachFileToChatMessage({
            userId: userIdFrom(res),
            apiKeys: apiKeysFrom(res),
            messageIdRaw:
                typeof req.body?.messageId === 'string'
                    ? req.body.messageId
                    : typeof req.body?.chatMessageId === 'string'
                      ? req.body.chatMessageId
                      : '',
            fileName: typeof req.body?.fileName === 'string' ? req.body.fileName : '',
            contentBase64: typeof req.body?.contentBase64 === 'string' ? req.body.contentBase64 : undefined,
            content: typeof req.body?.content === 'string' ? req.body.content : undefined,
            mimeType: typeof req.body?.mimeType === 'string' ? req.body.mimeType : undefined,
        });
        if (!result.ok) {
            return res.status(result.status).json({ message: result.message });
        }
        return res.status(201).json({
            success: true,
            id: result.id,
            messageId: result.messageId,
            fileName: result.fileName,
            originalName: result.originalName,
            size: result.size,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;
