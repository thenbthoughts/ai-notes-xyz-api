import mongoose from 'mongoose';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
    parseWebhookSearchSource,
    webhookSearchAll,
    webhookSearchSource,
} from '../webhook/webhookSearch';
import { attachFileToChatMessage } from '../../utils/chat/attachFileToChatMessage';
import { formatUserLibraryCountsLine, getUserLibraryCounts } from '../../utils/mcp/userLibraryCounts';
import type { tsUserApiKey } from '../../utils/llm/llmCommonFunc';

export const createAiNotesMcpServer = async ({
    userId,
    apiKeys,
    defaultChatMessageId,
}: {
    userId: mongoose.Types.ObjectId;
    apiKeys: tsUserApiKey;
    defaultChatMessageId: string;
}): Promise<McpServer> => {
    const library = await getUserLibraryCounts(userId);
    const server = new McpServer({
        name: 'ai-notes-xyz',
        version: '1.0.0',
    });

    server.registerTool(
        'search',
        {
            title: 'Search user data',
            description:
                `Search the signed-in user's notes, tasks, life events, memos, or info vault. The user currently has ${formatUserLibraryCountsLine(library)}. Call this before answering personal, life, goal, habit, or "how to improve" questions. Empty query returns recent items. Read only — do not create or update those records.`,
            inputSchema: {
                query: z.string().describe('Search keywords'),
                source: z
                    .enum(['all', 'notes', 'tasks', 'lifeEvents', 'memo', 'infoVault'])
                    .optional()
                    .describe('Which collection to search. Defaults to all.'),
            },
        },
        async ({ query, source }) => {
            const parsed = parseWebhookSearchSource(source ?? 'all');
            const items =
                parsed === 'all'
                    ? await webhookSearchAll({ userId, query: query || '' })
                    : await webhookSearchSource({ userId, source: parsed, query: query || '' });
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            query: query || '',
                            source: parsed,
                            count: items.length,
                            items,
                        }),
                    },
                ],
            };
        }
    );

    server.registerTool(
        'add_chat_file',
        {
            title: 'Attach file to AI chat message',
            description:
                'Upload a file and attach it to the current AI chat message (isAi stays true). Prefer the default messageId from this run. Send UTF-8 as content or any file as contentBase64. Max 8MB.',
            inputSchema: {
                fileName: z.string().describe('File name including extension, e.g. notes.txt'),
                contentBase64: z
                    .string()
                    .optional()
                    .describe('File bytes as base64. Use this for binary files.'),
                content: z.string().optional().describe('UTF-8 text content if not using contentBase64.'),
                mimeType: z.string().optional().describe('Optional MIME type.'),
                messageId: z
                    .string()
                    .optional()
                    .describe('Chat message id. Defaults to X-Chat-Message-Id for this OpenCode run.'),
            },
        },
        async ({ fileName, contentBase64, content, mimeType, messageId }) => {
            const resolvedMessageId = (messageId || defaultChatMessageId || '').trim();
            const result = await attachFileToChatMessage({
                userId,
                apiKeys,
                messageIdRaw: resolvedMessageId,
                fileName,
                contentBase64,
                content,
                mimeType,
            });
            if (!result.ok) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: result.message }],
                };
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            id: result.id,
                            messageId: result.messageId,
                            fileName: result.fileName,
                            originalName: result.originalName,
                            size: result.size,
                        }),
                    },
                ],
            };
        }
    );

    return server;
};
