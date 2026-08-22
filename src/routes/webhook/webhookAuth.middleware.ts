import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';
import { isWebhookTokenShape } from '../../utils/webhook/generateWebhookToken';

const readToken = (req: Request): string => {
    const header = req.headers['x-webhook-token'];
    if (typeof header === 'string' && header.trim()) {
        return header.trim();
    }
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
        return auth.slice(7).trim();
    }
    const query = req.query?.token;
    if (typeof query === 'string' && query.trim()) {
        return query.trim();
    }
    if (req.body && typeof req.body === 'object' && typeof (req.body as { token?: unknown }).token === 'string') {
        return String((req.body as { token: string }).token).trim();
    }
    return '';
};

/** Authenticate `/api/webhook/*` with the per-user webhook token (not cookie/device auth). */
const middlewareWebhookAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = readToken(req);
        if (!isWebhookTokenShape(token)) {
            return res.status(401).json({ message: 'Webhook token required (X-Webhook-Token)' });
        }
        const doc = await ModelUserApiKey.findOne({
            webhookToken: token,
            webhookTokenValid: true,
        });
        if (!doc) {
            return res.status(401).json({ message: 'Invalid webhook token' });
        }
        const userId = doc.userId as mongoose.Types.ObjectId;
        res.locals.auth_userId = userId;
        res.locals.apiKey = getApiKeyByObject(doc);
        next();
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
};

export default middlewareWebhookAuth;
