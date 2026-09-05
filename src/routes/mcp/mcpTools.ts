import mongoose from 'mongoose';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
    parseMcpSearchSource,
    mcpSearchAll,
    mcpSearchSource,
} from '../../utils/mcp/mcpSearch';
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
                `Search the signed-in user's notes, tasks, life events, memos, info vault. The user currently has ${formatUserLibraryCountsLine(library)}. Empty query returns recent items sorted by updated date. Supports source filter, pagination, sort, tags, dateRange and optional filters JSON for advanced field filters. For advanced filters pass JSON string with prefixed keys e.g. {"task_priority_exact":"high","memo_noteColor_exact":"blue"}.`,
            inputSchema: {
                query: z.string().max(500).optional().describe('Keywords. Empty returns recent. Alias: search.'),
                search: z.string().max(500).optional().describe('Alias for query.'),
                source: z.enum(['all', 'notes', 'tasks', 'lifeEvents', 'memo', 'infoVault']).optional().describe('Collection. Defaults to all.'),
                page: z.number().int().min(1).max(100).optional().describe('Page 1-100 default 1.'),
                perPage: z.number().int().min(1).max(40).optional().describe('Items per page 1-40 default 6 all / 8 single.'),
                sortBy: z.enum(['updatedAt', 'createdAt', 'relevance']).optional().describe('Sort field.'),
                order: z.enum(['asc', 'desc']).optional().describe('Sort order desc default.'),
                tags: z.array(z.string().max(50)).max(10).optional().describe('Filter by tags exact case-insensitive.'),
                dateRange: z.object({
                    createdAfter: z.string().optional().describe('ISO createdAt >='),
                    createdBefore: z.string().optional().describe('ISO createdAt <='),
                    updatedAfter: z.string().optional().describe('ISO updatedAt >='),
                    updatedBefore: z.string().optional().describe('ISO updatedAt <='),
                }).optional().describe('Date range filters.'),
                filters: z.string().max(2000).optional().describe('Optional JSON string for advanced prefixed filters e.g. {"task_priority_exact":"high","memo_noteColor_in":["blue"]}. Keys use original prefixed names like notes_title_regex, task_priority_exact, memo_noteColor_exact, lifeEvents_eventImpact_exact, infoVault_type_exact.'),
            },
        },
        async (args) => {
            const { query, search, source, page, perPage, sortBy, order, tags, dateRange, filters } = args as Record<string, unknown> & {
                query?: string; search?: string; source?: string; page?: number; perPage?: number; sortBy?: string; order?: string; tags?: string[];
                dateRange?: { createdAfter?: string; createdBefore?: string; updatedAfter?: string; updatedBefore?: string };
                filters?: string;
            };
            const q = ((search as string) ?? (query as string) ?? '').trim().slice(0, 500);
            const p = page !== undefined ? Math.min(Math.max(Math.trunc(page as number), 1), 100) : 1;
            const pp = perPage !== undefined ? Math.min(Math.max(Math.trunc(perPage as number), 1), 40) : source === 'all' || !source ? 6 : 8;
            const lim = pp;
            const off = (p - 1) * pp;
            const parseIso = (v: unknown, name: string): Date | undefined => {
                if (!v) return undefined;
                const d = new Date(String(v));
                if (Number.isNaN(d.getTime())) throw new Error(`Invalid ${name}: ${v} (use ISO)`);
                return d;
            };
            let createdAtGte: Date | undefined;
            let createdAtLte: Date | undefined;
            let updatedAtGte: Date | undefined;
            let updatedAtLte: Date | undefined;
            try {
                if (dateRange) {
                    createdAtGte = parseIso((dateRange as any).createdAfter, 'createdAfter');
                    createdAtLte = parseIso((dateRange as any).createdBefore, 'createdBefore');
                    updatedAtGte = parseIso((dateRange as any).updatedAfter, 'updatedAfter');
                    updatedAtLte = parseIso((dateRange as any).updatedBefore, 'updatedBefore');
                    if (createdAtGte && createdAtLte && createdAtGte > createdAtLte) throw new Error('createdAfter must be <= createdBefore');
                    if (updatedAtGte && updatedAtLte && updatedAtGte > updatedAtLte) throw new Error('updatedAfter must be <= updatedBefore');
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { isError: true, content: [{ type: 'text', text: msg }] };
            }
            const cleanTags = Array.isArray(tags) && tags.length ? [...new Set((tags as string[]).map((t) => String(t).trim().toLowerCase()).filter((t) => t.length >= 1 && t.length <= 50))].slice(0, 10) : undefined;
            const sort = sortBy === 'createdAt' ? 'createdAt' : sortBy === 'relevance' && q ? 'relevance' : 'updatedAt';
            const ord = order === 'asc' ? 'asc' : 'desc';
            const parsed = parseMcpSearchSource(source ?? 'all');
            let prefixed: Record<string, unknown> = {};
            if (typeof filters === 'string' && filters.trim()) {
                try {
                    const parsedFilters = JSON.parse(filters);
                    if (parsedFilters && typeof parsedFilters === 'object' && !Array.isArray(parsedFilters)) {
                        prefixed = parsedFilters as Record<string, unknown>;
                    } else {
                        return { isError: true, content: [{ type: 'text', text: 'filters must be a JSON object string' }] };
                    }
                } catch {
                    return { isError: true, content: [{ type: 'text', text: 'filters is not valid JSON' }] };
                }
            }
            // validate prefixed ObjectId-like filters
            const isHex24 = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
            for (const [k, v] of Object.entries(prefixed)) {
                if (v === undefined || v === null || v === '') continue;
                if (k.endsWith('_exact') && (k.includes('workspaceId') || k.includes('statusId') || k.includes('categoryId'))) {
                    if (!isHex24(v) && !(Array.isArray(v) && (v as unknown[]).every(isHex24))) return { isError: true, content: [{ type: 'text', text: `Invalid ${k}: must be 24 hex ObjectId` }] };
                }
            }
            const common = {
                query: q, limit: lim, offset: off, sortBy: sort as 'updatedAt' | 'createdAt' | 'relevance', order: ord as 'asc' | 'desc',
                createdAfter: createdAtGte, createdBefore: createdAtLte, updatedAfter: updatedAtGte, updatedBefore: updatedAtLte, tags: cleanTags, prefixed,
            };
            try {
                const items = parsed === 'all' ? await mcpSearchAll({ userId, ...common, limitPerSource: lim } as any) : await mcpSearchSource({ userId, source: parsed, ...common, limit: lim } as any);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, query: q, source: parsed, count: items.length, page: p, perPage: pp, sortBy: sort, order: ord, items }) }] };
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { isError: true, content: [{ type: 'text', text: `Search failed: ${msg}` }] };
            }
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

    // --- 5 dedicated lean search tools (plus generic search + file upload = 7 total) ---
    const leanDateRangeSchema = z.object({
        createdAfter: z.string().optional().describe('ISO createdAt >='),
        createdBefore: z.string().optional().describe('ISO createdAt <='),
        updatedAfter: z.string().optional().describe('ISO updatedAt >='),
        updatedBefore: z.string().optional().describe('ISO updatedAt <='),
    }).optional().describe('Date range filters.');

    const buildLeanSearch = (args: Record<string, unknown>) => {
        const q = ((args.search as string) ?? (args.query as string) ?? '').trim().slice(0, 500);
        const p = args.page !== undefined ? Math.min(Math.max(Math.trunc(args.page as number), 1), 100) : 1;
        const pp = args.perPage !== undefined ? Math.min(Math.max(Math.trunc(args.perPage as number), 1), 40) : 8;
        const sortBy = args.sortBy === 'createdAt' ? 'createdAt' : args.sortBy === 'relevance' && q ? 'relevance' : 'updatedAt';
        const order = args.order === 'asc' ? 'asc' : 'desc';
        const parseIso = (v: unknown, name: string): Date | undefined => {
            if (!v || typeof v !== 'string' || !v.trim()) return undefined;
            const d = new Date(String(v));
            if (Number.isNaN(d.getTime())) throw new Error(`Invalid ${name}: ${v} (use ISO)`);
            return d;
        };
        const dr = args.dateRange as { createdAfter?: string; createdBefore?: string; updatedAfter?: string; updatedBefore?: string } | undefined;
        let createdAtGte: Date | undefined;
        let createdAtLte: Date | undefined;
        let updatedAtGte: Date | undefined;
        let updatedAtLte: Date | undefined;
        try {
            if (dr) {
                createdAtGte = parseIso(dr.createdAfter, 'createdAfter');
                createdAtLte = parseIso(dr.createdBefore, 'createdBefore');
                updatedAtGte = parseIso(dr.updatedAfter, 'updatedAfter');
                updatedAtLte = parseIso(dr.updatedBefore, 'updatedBefore');
            }
        } catch (e) {
            throw e;
        }
        const cleanTags = Array.isArray(args.tags) && args.tags.length ? [...new Set((args.tags as string[]).map((t) => String(t).trim().toLowerCase()).filter((t) => t.length >= 1 && t.length <= 50))].slice(0, 10) : undefined;
        let extraPrefixed: Record<string, unknown> = {};
        if (typeof args.filters === 'string' && (args.filters as string).trim()) {
            try {
                const jf = JSON.parse(args.filters as string);
                if (jf && typeof jf === 'object' && !Array.isArray(jf)) extraPrefixed = jf as Record<string, unknown>;
            } catch {
                throw new Error('filters is not valid JSON');
            }
        }
        return { query: q, lim: pp, off: (p - 1) * pp, sortBy, order, cleanTags, extraPrefixed, createdAtGte, createdAtLte, updatedAtGte, updatedAtLte, p, pp };
    };

    server.registerTool(
        'search_notes',
        {
            title: 'Search notes',
            description: 'Search only notes. Lean filters: title contains, starred, workspace, tags, dateRange, plus optional advanced filters JSON.',
            inputSchema: {
                query: z.string().max(500).optional().describe('Keywords. Empty returns recent.'),
                search: z.string().max(500).optional().describe('Alias for query.'),
                page: z.number().int().min(1).max(100).optional().describe('Page 1-100 default 1.'),
                perPage: z.number().int().min(1).max(40).optional().describe('Items per page 1-40 default 8.'),
                sortBy: z.enum(['updatedAt', 'createdAt', 'relevance']).optional().describe('Sort field.'),
                order: z.enum(['asc', 'desc']).optional().describe('Sort order.'),
                title: z.string().max(200).optional().describe('Title contains (case-insensitive regex).'),
                isStar: z.boolean().optional().describe('Starred filter.'),
                workspaceId: z.string().max(24).optional().describe('Workspace ObjectId 24hex.'),
                tags: z.array(z.string().max(50)).max(10).optional().describe('Filter by tags exact.'),
                dateRange: leanDateRangeSchema,
                filters: z.string().max(2000).optional().describe('Advanced JSON e.g. {"notes_tags_in":["work"]} for any prefixed filter.'),
            },
        },
        async (args) => {
            try {
                const c = buildLeanSearch(args as Record<string, unknown>);
                const prefixed: Record<string, unknown> = { ...c.extraPrefixed };
                if (typeof (args as any).title === 'string' && (args as any).title.trim()) prefixed['notes_title_regex'] = (args as any).title.trim();
                if (typeof (args as any).isStar === 'boolean') prefixed['notes_isStar_exact'] = (args as any).isStar;
                if (typeof (args as any).workspaceId === 'string' && (args as any).workspaceId.trim()) prefixed['notes_workspaceId_exact'] = (args as any).workspaceId.trim();
                const items = await mcpSearchSource({ userId, source: 'notes', query: c.query, limit: c.lim, offset: c.off, sortBy: c.sortBy as any, order: c.order as any, tags: c.cleanTags, prefixed, createdAfter: c.createdAtGte, createdBefore: c.createdAtLte, updatedAfter: c.updatedAtGte, updatedBefore: c.updatedAtLte } as any);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, query: c.query, source: 'notes', count: items.length, page: c.p, perPage: c.pp, items }) }] };
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { isError: true, content: [{ type: 'text', text: `search_notes failed: ${msg}` }] };
            }
        }
    );

    server.registerTool(
        'search_memo',
        {
            title: 'Search memos',
            description: 'Search only memos. Lean filters: title/body contains, pinned, noteColor, dateRange, plus advanced JSON.',
            inputSchema: {
                query: z.string().max(500).optional().describe('Keywords.'),
                search: z.string().max(500).optional().describe('Alias.'),
                page: z.number().int().min(1).max(100).optional().describe('Page.'),
                perPage: z.number().int().min(1).max(40).optional().describe('Per page.'),
                sortBy: z.enum(['updatedAt', 'createdAt', 'relevance']).optional().describe('Sort.'),
                order: z.enum(['asc', 'desc']).optional().describe('Order.'),
                title: z.string().max(200).optional().describe('Title contains.'),
                pinned: z.boolean().optional().describe('Pinned filter.'),
                noteColor: z.enum(['coral', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'gray']).optional().describe('Note color.'),
                dateRange: leanDateRangeSchema,
                filters: z.string().max(2000).optional().describe('Advanced JSON e.g. {"memo_labelIds_in":["..."]}'),
            },
        },
        async (args) => {
            try {
                const c = buildLeanSearch(args as Record<string, unknown>);
                const prefixed: Record<string, unknown> = { ...c.extraPrefixed };
                if (typeof (args as any).title === 'string' && (args as any).title.trim()) prefixed['memo_title_regex'] = (args as any).title.trim();
                if (typeof (args as any).pinned === 'boolean') prefixed['memo_pinned_exact'] = (args as any).pinned;
                if (typeof (args as any).noteColor === 'string' && (args as any).noteColor.trim()) prefixed['memo_noteColor_exact'] = (args as any).noteColor.trim();
                const items = await mcpSearchSource({ userId, source: 'memo', query: c.query, limit: c.lim, offset: c.off, sortBy: c.sortBy as any, order: c.order as any, prefixed, createdAfter: c.createdAtGte, createdBefore: c.createdAtLte, updatedAfter: c.updatedAtGte, updatedBefore: c.updatedAtLte } as any);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, query: c.query, source: 'memo', count: items.length, page: c.p, perPage: c.pp, items }) }] };
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { isError: true, content: [{ type: 'text', text: `search_memo failed: ${msg}` }] };
            }
        }
    );

    server.registerTool(
        'search_tasks',
        {
            title: 'Search tasks',
            description: 'Search only tasks. Lean filters: title, priority, isCompleted, workspace, dateRange, plus advanced JSON.',
            inputSchema: {
                query: z.string().max(500).optional().describe('Keywords.'),
                search: z.string().max(500).optional().describe('Alias.'),
                page: z.number().int().min(1).max(100).optional().describe('Page.'),
                perPage: z.number().int().min(1).max(40).optional().describe('Per page.'),
                sortBy: z.enum(['updatedAt', 'createdAt', 'relevance']).optional().describe('Sort.'),
                order: z.enum(['asc', 'desc']).optional().describe('Order.'),
                title: z.string().max(200).optional().describe('Title contains.'),
                priority: z.enum(['very-low', 'low', 'medium', 'high', 'very-high']).optional().describe('Priority.'),
                isCompleted: z.boolean().optional().describe('Completed filter.'),
                workspaceId: z.string().max(24).optional().describe('Workspace 24hex.'),
                tags: z.array(z.string().max(50)).max(10).optional().describe('Filter by tags.'),
                dateRange: leanDateRangeSchema,
                filters: z.string().max(2000).optional().describe('Advanced JSON e.g. {"task_labels_in":["urgent"],"task_dueDate_gte":"2026-01-01"}'),
            },
        },
        async (args) => {
            try {
                const c = buildLeanSearch(args as Record<string, unknown>);
                const prefixed: Record<string, unknown> = { ...c.extraPrefixed };
                if (typeof (args as any).title === 'string' && (args as any).title.trim()) prefixed['task_title_regex'] = (args as any).title.trim();
                if (typeof (args as any).priority === 'string' && (args as any).priority.trim()) prefixed['task_priority_exact'] = (args as any).priority.trim();
                if (typeof (args as any).isCompleted === 'boolean') prefixed['task_isCompleted_exact'] = (args as any).isCompleted;
                if (typeof (args as any).workspaceId === 'string' && (args as any).workspaceId.trim()) prefixed['task_workspaceId_exact'] = (args as any).workspaceId.trim();
                const items = await mcpSearchSource({ userId, source: 'tasks', query: c.query, limit: c.lim, offset: c.off, sortBy: c.sortBy as any, order: c.order as any, tags: c.cleanTags, prefixed, createdAfter: c.createdAtGte, createdBefore: c.createdAtLte, updatedAfter: c.updatedAtGte, updatedBefore: c.updatedAtLte } as any);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, query: c.query, source: 'tasks', count: items.length, page: c.p, perPage: c.pp, items }) }] };
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { isError: true, content: [{ type: 'text', text: `search_tasks failed: ${msg}` }] };
            }
        }
    );

    server.registerTool(
        'search_life_events',
        {
            title: 'Search life events',
            description: 'Search only life events. Lean filters: title, eventImpact, year, dateRange, plus advanced JSON.',
            inputSchema: {
                query: z.string().max(500).optional().describe('Keywords.'),
                search: z.string().max(500).optional().describe('Alias.'),
                page: z.number().int().min(1).max(100).optional().describe('Page.'),
                perPage: z.number().int().min(1).max(40).optional().describe('Per page.'),
                sortBy: z.enum(['updatedAt', 'createdAt', 'relevance']).optional().describe('Sort.'),
                order: z.enum(['asc', 'desc']).optional().describe('Order.'),
                title: z.string().max(200).optional().describe('Title contains.'),
                eventImpact: z.enum(['very-low', 'low', 'medium', 'large', 'huge']).optional().describe('Impact.'),
                year: z.string().max(4).optional().describe('Year YYYY.'),
                dateRange: leanDateRangeSchema,
                filters: z.string().max(2000).optional().describe('Advanced JSON e.g. {"lifeEvents_categoryId_exact":"..."}'),
            },
        },
        async (args) => {
            try {
                const c = buildLeanSearch(args as Record<string, unknown>);
                const prefixed: Record<string, unknown> = { ...c.extraPrefixed };
                if (typeof (args as any).title === 'string' && (args as any).title.trim()) prefixed['lifeEvents_title_regex'] = (args as any).title.trim();
                if (typeof (args as any).eventImpact === 'string' && (args as any).eventImpact.trim()) prefixed['lifeEvents_eventImpact_exact'] = (args as any).eventImpact.trim();
                if (typeof (args as any).year === 'string' && (args as any).year.trim()) prefixed['lifeEvents_year_exact'] = (args as any).year.trim();
                const items = await mcpSearchSource({ userId, source: 'lifeEvents', query: c.query, limit: c.lim, offset: c.off, sortBy: c.sortBy as any, order: c.order as any, prefixed, createdAfter: c.createdAtGte, createdBefore: c.createdAtLte, updatedAfter: c.updatedAtGte, updatedBefore: c.updatedAtLte } as any);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, query: c.query, source: 'lifeEvents', count: items.length, page: c.p, perPage: c.pp, items }) }] };
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { isError: true, content: [{ type: 'text', text: `search_life_events failed: ${msg}` }] };
            }
        }
    );

    server.registerTool(
        'search_info_vault',
        {
            title: 'Search info vault',
            description: 'Search only info vault. Lean filters: name, type, isFavorite, tags, dateRange, plus advanced JSON.',
            inputSchema: {
                query: z.string().max(500).optional().describe('Keywords.'),
                search: z.string().max(500).optional().describe('Alias.'),
                page: z.number().int().min(1).max(100).optional().describe('Page.'),
                perPage: z.number().int().min(1).max(40).optional().describe('Per page.'),
                sortBy: z.enum(['updatedAt', 'createdAt', 'relevance']).optional().describe('Sort.'),
                order: z.enum(['asc', 'desc']).optional().describe('Order.'),
                name: z.string().max(200).optional().describe('Name contains.'),
                type: z.enum(['myself', 'contact', 'place', 'event', 'document', 'product', 'asset', 'media', 'other']).optional().describe('Vault type.'),
                isFavorite: z.boolean().optional().describe('Favorite filter.'),
                tags: z.array(z.string().max(50)).max(10).optional().describe('Filter by tags.'),
                dateRange: leanDateRangeSchema,
                filters: z.string().max(2000).optional().describe('Advanced JSON e.g. {"infoVault_company_regex":"Acme"}'),
            },
        },
        async (args) => {
            try {
                const c = buildLeanSearch(args as Record<string, unknown>);
                const prefixed: Record<string, unknown> = { ...c.extraPrefixed };
                if (typeof (args as any).name === 'string' && (args as any).name.trim()) prefixed['infoVault_name_regex'] = (args as any).name.trim();
                if (typeof (args as any).type === 'string' && (args as any).type.trim()) prefixed['infoVault_type_exact'] = (args as any).type.trim();
                if (typeof (args as any).isFavorite === 'boolean') prefixed['infoVault_isFavorite_exact'] = (args as any).isFavorite;
                const items = await mcpSearchSource({ userId, source: 'infoVault', query: c.query, limit: c.lim, offset: c.off, sortBy: c.sortBy as any, order: c.order as any, tags: c.cleanTags, prefixed, createdAfter: c.createdAtGte, createdBefore: c.createdAtLte, updatedAfter: c.updatedAtGte, updatedBefore: c.updatedAtLte } as any);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, query: c.query, source: 'infoVault', count: items.length, page: c.p, perPage: c.pp, items }) }] };
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { isError: true, content: [{ type: 'text', text: `search_info_vault failed: ${msg}` }] };
            }
        }
    );

    return server;
};
