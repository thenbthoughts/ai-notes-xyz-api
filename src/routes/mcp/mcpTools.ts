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
                `Search the signed-in user's notes, tasks, life events, memos, info vault, workspaces, and short-term memory. The user currently has ${formatUserLibraryCountsLine(library)}. Call this before answering personal, life, goal, habit, or "how to improve" questions. Empty query returns recent items sorted by updated date. Read only — do not create or update those records. Supports pagination (page/perPage), date ranges (createdAt_*/updatedAt_* with gte/lte/gt/lt), tags, and per-field task_/notes_/memo_/lifeEvents_/infoVault_/notesWorkspace_/taskWorkspace_/shortTermMemory_ filters with regex/exact/in and AND semantics. Also searches short-term memory (userMemory isPermanent=false) and workspaces.`,
            inputSchema: {
                // Common
                query: z.string().max(500, 'Query too long (max 500)').optional().describe('Search keywords (max 500). Empty returns recent. Alias: search.'),
                search: z.string().max(500).optional().describe('Alias for query. If both, search wins.'),
                source: z.enum(['all', 'notes', 'notesWorkspace', 'tasks', 'taskWorkspace', 'lifeEvents', 'memo', 'infoVault', 'shortTermMemory']).optional().describe('Which collection. Defaults to all. Includes workspaces and shortTermMemory.'),
                page: z.number().int().min(1).max(100).optional().describe('Page number (1-100, default 1). Overrides offset.'),
                perPage: z.number().int().min(1).max(40).optional().describe('Items per page (1-40, default 8 single / 6 all). Overrides limit.'),
                limit: z.number().int().min(1).max(40).optional().describe('[Deprecated] use perPage. Max results per source.'),
                offset: z.number().int().min(0).max(1000).optional().describe('[Deprecated] use page. Skip N.'),
                sortBy: z.enum(['updatedAt', 'createdAt', 'relevance']).optional().describe('Sort field: updatedAt (default), createdAt, relevance.'),
                order: z.enum(['asc', 'desc']).optional().describe('Sort order: desc default.'),
                // Common dates with gte/lte strategy
                createdAt_gte: z.string().optional().describe('ISO date — createdAt >= value.'),
                createdAt_lte: z.string().optional().describe('ISO date — createdAt <= value.'),
                createdAt_gt: z.string().optional().describe('ISO date — createdAt > value.'),
                createdAt_lt: z.string().optional().describe('ISO date — createdAt < value.'),
                updatedAt_gte: z.string().optional().describe('ISO date — updatedAt >= value.'),
                updatedAt_lte: z.string().optional().describe('ISO date — updatedAt <= value.'),
                updatedAt_gt: z.string().optional().describe('ISO date — updatedAt > value.'),
                updatedAt_lt: z.string().optional().describe('ISO date — updatedAt < value.'),
                fromDate: z.string().optional().describe('[Deprecated] alias for updatedAt_gte.'),
                toDate: z.string().optional().describe('[Deprecated] alias for updatedAt_lte.'),
                tags: z.array(z.string().min(1).max(50)).max(10).optional().describe('Filter by tags (exact, case-insensitive). Applies to notes/tasks/infoVault).'),
                // Deprecated direct booleans kept for compat
                isCompleted: z.boolean().optional().describe('[Deprecated] use task_isCompleted_exact.'),
                isArchived: z.boolean().optional().describe('[Deprecated] use memo_isArchived_exact / infoVault_isArchived_exact.'),
                pinned: z.boolean().optional().describe('[Deprecated] use memo_pinned_exact.'),
                // Notes prefixed — string: regex/exact/in/nin/exists, boolean: exact
                notes_title_regex: z.string().max(200).optional().describe('Notes: title regex (case-insensitive, e.g. "meeting").'),
                notes_title_exact: z.string().max(200).optional().describe('Notes: title exact (case-insensitive ^$).'),
                notes_title_in: z.array(z.string().max(200)).max(10).optional().describe('Notes: title in array (exact).'),
                notes_description_regex: z.string().max(500).optional().describe('Notes: description regex.'),
                notes_description_exact: z.string().max(500).optional().describe('Notes: description exact.'),
                notes_isStar_exact: z.boolean().optional().describe('Notes: isStar exact.'),
                notes_workspaceId_exact: z.string().max(24).optional().describe('Notes: workspaceId exact (24 hex ObjectId).'),
                notes_workspaceId_in: z.array(z.string().max(24)).max(10).optional().describe('Notes: workspaceId in.'),
                notes_createdAt_gte: z.string().optional().describe('Notes: createdAt >= ISO.'),
                notes_createdAt_lte: z.string().optional().describe('Notes: createdAt <= ISO.'),
                notes_updatedAt_gte: z.string().optional().describe('Notes: updatedAt >= ISO.'),
                notes_updatedAt_lte: z.string().optional().describe('Notes: updatedAt <= ISO.'),
                notes_tags_in: z.array(z.string().max(50)).max(10).optional().describe('Notes: tags in.'),
                // Tasks prefixed — extensive
                task_title_regex: z.string().max(200).optional().describe('Tasks: title regex.'),
                task_title_exact: z.string().max(200).optional().describe('Tasks: title exact.'),
                task_title_in: z.array(z.string().max(200)).max(10).optional().describe('Tasks: title in.'),
                task_description_regex: z.string().max(500).optional().describe('Tasks: description regex.'),
                task_description_exact: z.string().max(500).optional().describe('Tasks: description exact.'),
                task_priority_exact: z.enum(['', 'very-low', 'low', 'medium', 'high', 'very-high']).optional().describe('Tasks: priority exact.'),
                task_priority_in: z.array(z.enum(['', 'very-low', 'low', 'medium', 'high', 'very-high'])).max(10).optional().describe('Tasks: priority in.'),
                task_dueDate_gte: z.string().optional().describe('Tasks: dueDate >= ISO.'),
                task_dueDate_lte: z.string().optional().describe('Tasks: dueDate <= ISO.'),
                task_dueDate_gt: z.string().optional().describe('Tasks: dueDate > ISO.'),
                task_dueDate_lt: z.string().optional().describe('Tasks: dueDate < ISO.'),
                task_dueDate_eq: z.string().optional().describe('Tasks: dueDate == day (ISO).'),
                task_dueDate_exists: z.boolean().optional().describe('Tasks: dueDate exists (true has date, false null).'),
                task_isCompleted_exact: z.boolean().optional().describe('Tasks: isCompleted exact.'),
                task_isArchived_exact: z.boolean().optional().describe('Tasks: isArchived exact.'),
                task_isPinned_exact: z.boolean().optional().describe('Tasks: isTaskPinned exact.'),
                task_workspaceId_exact: z.string().max(24).optional().describe('Tasks: workspaceId exact.'),
                task_statusId_exact: z.string().max(24).optional().describe('Tasks: statusId exact.'),
                task_labels_regex: z.string().max(50).optional().describe('Tasks: labels regex.'),
                task_labels_exact: z.string().max(50).optional().describe('Tasks: labels exact.'),
                task_labels_in: z.array(z.string().max(50)).max(10).optional().describe('Tasks: labels in.'),
                task_createdAt_gte: z.string().optional().describe('Tasks: createdAt >= ISO.'),
                task_createdAt_lte: z.string().optional().describe('Tasks: createdAt <= ISO.'),
                task_updatedAt_gte: z.string().optional().describe('Tasks: updatedAt >= ISO.'),
                task_updatedAt_lte: z.string().optional().describe('Tasks: updatedAt <= ISO.'),
                // Memo prefixed
                memo_title_regex: z.string().max(200).optional().describe('Memo: title regex.'),
                memo_title_exact: z.string().max(200).optional().describe('Memo: title exact.'),
                memo_body_regex: z.string().max(500).optional().describe('Memo: body regex.'),
                memo_body_exact: z.string().max(500).optional().describe('Memo: body exact.'),
                memo_pinned_exact: z.boolean().optional().describe('Memo: pinned exact.'),
                memo_archived_exact: z.boolean().optional().describe('Memo: archived exact.'),
                memo_trashed_exact: z.boolean().optional().describe('Memo: trashed exact.'),
                memo_noteColor_exact: z.enum(['', 'coral', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'gray']).optional().describe('Memo: noteColor exact.'),
                memo_noteColor_in: z.array(z.enum(['', 'coral', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'gray'])).max(10).optional().describe('Memo: noteColor in.'),
                memo_labelIds_in: z.array(z.string().max(24)).max(10).optional().describe('Memo: labelIds in (ObjectId).'),
                // LifeEvents prefixed
                lifeEvents_title_regex: z.string().max(200).optional().describe('LifeEvents: title regex.'),
                lifeEvents_title_exact: z.string().max(200).optional().describe('LifeEvents: title exact.'),
                lifeEvents_isStar_exact: z.boolean().optional().describe('LifeEvents: isStar exact.'),
                lifeEvents_eventImpact_exact: z.enum(['very-low', 'low', 'medium', 'large', 'huge']).optional().describe('LifeEvents: eventImpact exact.'),
                lifeEvents_eventImpact_in: z.array(z.enum(['very-low', 'low', 'medium', 'large', 'huge'])).max(10).optional().describe('LifeEvents: eventImpact in.'),
                lifeEvents_eventDate_gte: z.string().optional().describe('LifeEvents: eventDate >= ISO.'),
                lifeEvents_eventDate_lte: z.string().optional().describe('LifeEvents: eventDate <= ISO.'),
                lifeEvents_eventDate_gt: z.string().optional().describe('LifeEvents: eventDate > ISO.'),
                lifeEvents_eventDate_lt: z.string().optional().describe('LifeEvents: eventDate < ISO.'),
                lifeEvents_year_exact: z.string().max(4).optional().describe('LifeEvents: year exact (YYYY) → eventDateYearStr.'),
                lifeEvents_yearMonth_exact: z.string().max(7).optional().describe('LifeEvents: yearMonth exact (YYYY-MM).'),
                lifeEvents_categoryId_exact: z.string().max(24).optional().describe('LifeEvents: categoryId exact.'),
                // InfoVault prefixed
                infoVault_name_regex: z.string().max(200).optional().describe('InfoVault: name regex.'),
                infoVault_name_exact: z.string().max(200).optional().describe('InfoVault: name exact.'),
                infoVault_company_regex: z.string().max(200).optional().describe('InfoVault: company regex.'),
                infoVault_company_exact: z.string().max(200).optional().describe('InfoVault: company exact.'),
                infoVault_type_exact: z.enum(['myself', 'contact', 'place', 'event', 'document', 'product', 'asset', 'media', 'other', '']).optional().describe('InfoVault: type exact.'),
                infoVault_isFavorite_exact: z.boolean().optional().describe('InfoVault: isFavorite exact.'),
                infoVault_isBlocked_exact: z.boolean().optional().describe('InfoVault: isBlocked exact.'),
                infoVault_isArchived_exact: z.boolean().optional().describe('InfoVault: isArchived exact.'),
                infoVault_relationshipType_exact: z.enum(['myself', 'personal', 'professional', 'family', 'other']).optional().describe('InfoVault: relationshipType exact.'),
                infoVault_lastContact_gte: z.string().optional().describe('InfoVault: lastContactDate >= ISO.'),
                infoVault_lastContact_lte: z.string().optional().describe('InfoVault: lastContactDate <= ISO.'),
            },
        },
        async (args) => {
            const {
                query,
                search,
                source,
                page,
                perPage,
                limit,
                offset,
                sortBy,
                order,
                createdAt_gte,
                createdAt_lte,
                createdAt_gt,
                createdAt_lt,
                updatedAt_gte,
                updatedAt_lte,
                updatedAt_gt,
                updatedAt_lt,
                fromDate,
                toDate,
                tags,
                isCompleted,
                isArchived,
                pinned,
                // spread rest prefixed
                ...prefixed
            } = args as Record<string, unknown> & {
                query?: string;
                search?: string;
                source?: string;
                page?: number;
                perPage?: number;
                limit?: number;
                offset?: number;
                sortBy?: string;
                order?: string;
                createdAt_gte?: string;
                createdAt_lte?: string;
                createdAt_gt?: string;
                createdAt_lt?: string;
                updatedAt_gte?: string;
                updatedAt_lte?: string;
                updatedAt_gt?: string;
                updatedAt_lt?: string;
                fromDate?: string;
                toDate?: string;
                tags?: string[];
                isCompleted?: boolean;
                isArchived?: boolean;
                pinned?: boolean;
            };

            // --- validations & normalization ---
            const q = ((search as string) ?? (query as string) ?? '').trim().slice(0, 500);

            // page/perPage override limit/offset
            let lim: number | undefined;
            let off = 0;
            if (page !== undefined || perPage !== undefined) {
                const p = page !== undefined ? Math.min(Math.max(Math.trunc(page as number), 1), 100) : 1;
                const pp = perPage !== undefined ? Math.min(Math.max(Math.trunc(perPage as number), 1), 40) : source === 'all' ? 6 : 8;
                lim = pp;
                off = (p - 1) * pp;
            } else {
                lim = limit !== undefined ? Math.min(Math.max(Math.trunc(limit as number), 1), 40) : undefined;
                off = offset !== undefined ? Math.min(Math.max(Math.trunc(offset as number), 0), 1000) : 0;
            }

            const parseIso = (v: unknown, name: string): Date | undefined => {
                if (!v) return undefined;
                const d = new Date(String(v));
                if (Number.isNaN(d.getTime())) throw new Error(`Invalid ${name}: ${v} (use ISO YYYY-MM-DD)`);
                return d;
            };

            let from: Date | undefined;
            let to: Date | undefined;
            let cGte: Date | undefined;
            let cLte: Date | undefined;
            let cGt: Date | undefined;
            let cLt: Date | undefined;
            let uGte: Date | undefined;
            let uLte: Date | undefined;
            let uGt: Date | undefined;
            let uLt: Date | undefined;
            try {
                from = parseIso(fromDate, 'fromDate');
                to = parseIso(toDate, 'toDate');
                cGte = parseIso(createdAt_gte, 'createdAt_gte');
                cLte = parseIso(createdAt_lte, 'createdAt_lte');
                cGt = parseIso(createdAt_gt, 'createdAt_gt');
                cLt = parseIso(createdAt_lt, 'createdAt_lt');
                uGte = parseIso(updatedAt_gte ?? fromDate, 'updatedAt_gte');
                uLte = parseIso(updatedAt_lte ?? toDate, 'updatedAt_lte');
                uGt = parseIso(updatedAt_gt, 'updatedAt_gt');
                uLt = parseIso(updatedAt_lt, 'updatedAt_lt');
                if (from && to && from > to) throw new Error('fromDate must be <= toDate');
                if (cGte && cLte && cGte > cLte) throw new Error('createdAt_gte must be <= createdAt_lte');
                if (uGte && uLte && uGte > uLte) throw new Error('updatedAt_gte must be <= updatedAt_lte');
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { isError: true, content: [{ type: 'text', text: msg }] };
            }

            const cleanTags =
                Array.isArray(tags) && tags.length
                    ? [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter((t) => t.length >= 1 && t.length <= 50))].slice(0, 10)
                    : undefined;

            const sort = sortBy === 'createdAt' ? 'createdAt' : sortBy === 'relevance' && q ? 'relevance' : 'updatedAt';
            const ord = order === 'asc' ? 'asc' : 'desc';

            const parsed = parseMcpSearchSource(source ?? 'all');

            // Build prefixed filter passthrough with validation helpers
            const isHex24 = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
            const validatePrefixed = (): string | null => {
                for (const [k, v] of Object.entries(prefixed)) {
                    if (v === undefined || v === null || v === '') continue;
                    if (k.endsWith('_exact') && k.includes('workspaceId') || k.endsWith('_exact') && k.includes('statusId') || k.endsWith('_exact') && k.includes('categoryId')) {
                        if (!isHex24(v) && !(Array.isArray(v) && v.every(isHex24))) return `Invalid ${k}: must be 24 hex ObjectId`;
                    }
                    if (k.endsWith('_in') && Array.isArray(v) && v.some((x) => typeof x === 'string' && x.length > 200)) return `Invalid ${k}: string too long`;
                    if (k.includes('year_exact') && v && !/^\d{4}$/.test(String(v))) return `Invalid ${k}: must be YYYY`;
                    if (k.includes('yearMonth_exact') && v && !/^\d{4}-\d{2}$/.test(String(v))) return `Invalid ${k}: must be YYYY-MM`;
                }
                return null;
            };
            const vErr = validatePrefixed();
            if (vErr) return { isError: true, content: [{ type: 'text', text: vErr }] };

            const common = {
                query: q,
                limit: lim,
                offset: off,
                sortBy: sort as 'updatedAt' | 'createdAt' | 'relevance',
                order: ord as 'asc' | 'desc',
                fromDate: uGte ?? from,
                toDate: uLte ?? to,
                createdAtGte: cGte,
                createdAtLte: cLte,
                createdAtGt: cGt,
                createdAtLt: cLt,
                updatedAtGte: uGte,
                updatedAtGt: uGt,
                updatedAtLt: uLt,
                updatedAtLte: uLte,
                tags: cleanTags,
                isCompleted: isCompleted as boolean | undefined,
                isArchived: isArchived as boolean | undefined,
                pinned: pinned as boolean | undefined,
                prefixed: prefixed as Record<string, unknown>,
            };

            try {
                const items =
                    parsed === 'all'
                        ? await mcpSearchAll({ userId, ...common, limitPerSource: lim ?? 6 } as any)
                        : await mcpSearchSource({ userId, source: parsed, ...common, limit: lim ?? 8 } as any);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                query: q,
                                source: parsed,
                                count: items.length,
                                page: page ?? Math.floor(off / (lim ?? (parsed === 'all' ? 6 : 8))) + 1,
                                perPage: lim ?? (parsed === 'all' ? 6 : 8),
                                limit: common.limit ?? (parsed === 'all' ? 6 : 8),
                                offset: off,
                                sortBy: sort,
                                order: ord,
                                items,
                            }),
                        },
                    ],
                };
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

    return server;
};
