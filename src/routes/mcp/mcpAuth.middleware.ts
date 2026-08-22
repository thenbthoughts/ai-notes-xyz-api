import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';
import { isWebhookTokenShape } from '../../utils/webhook/generateWebhookToken';

const readToken = (req: Request): string => {
    const header = req.headers['x-mcp-bearer'];
    if (typeof header === 'string' && header.trim()) {
        return header.trim();
    }
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
        return auth.slice(7).trim();
    }
    return '';
};

/** Authenticate `/api/mcp` with the per-user MCP bearer token (not cookie/device auth). */
const middlewareMcpAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = readToken(req);
        if (!isWebhookTokenShape(token)) {
            return res.status(401).json({ message: 'MCP bearer token required (Authorization: Bearer)' });
        }
        const doc = await ModelUserApiKey.findOne({
            mcpBearerToken: token,
            mcpBearerTokenValid: true,
        });
        if (!doc) {
            return res.status(401).json({ message: 'Invalid MCP bearer token' });
        }
        res.locals.auth_userId = doc.userId as mongoose.Types.ObjectId;
        res.locals.apiKey = getApiKeyByObject(doc);
        const chatMessageId = req.headers['x-chat-message-id'];
        res.locals.chatMessageId = typeof chatMessageId === 'string' ? chatMessageId.trim() : '';
        next();
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
};

export default middlewareMcpAuth;
