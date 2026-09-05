import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import middlewareMcpAuth from './mcpAuth.middleware';
import { createAiNotesMcpServer } from './mcpTools';
import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';

const router = Router();

router.get('/info', (_req: Request, res: Response) => {
    return res.json({
        success: true,
        name: 'ai-notes-xyz',
        mcp: true,
        tools: ['search', 'add_chat_file', 'search_notes', 'search_memo', 'search_tasks', 'search_life_events', 'search_info_vault'],
    });
});

router.use(middlewareMcpAuth);

const handleMcp = async (req: Request, res: Response) => {
    try {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        const server = await createAiNotesMcpServer({
            userId: res.locals.auth_userId as mongoose.Types.ObjectId,
            apiKeys: getApiKeyByObject(res.locals.apiKey),
            defaultChatMessageId:
                typeof res.locals.chatMessageId === 'string' ? res.locals.chatMessageId : '',
        });
        res.on('close', () => {
            void transport.close();
            void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Server error' });
        }
    }
};

router.post('/', handleMcp);
router.get('/', handleMcp);
router.delete('/', handleMcp);

export default router;
