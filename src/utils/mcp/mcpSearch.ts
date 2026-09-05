import mongoose from 'mongoose';

import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { ModelNotesWorkspace } from '../../schema/schemaNotes/SchemaNotesWorkspace.schema';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { ModelTaskWorkspace } from '../../schema/schemaTask/SchemaTaskWorkspace.schema';
import { ModelLifeEvents } from '../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';
import { ModelMemoNote } from '../../schema/schemaMemo/SchemaMemoNote.schema';
import { ModelUserMemory } from '../../schema/schemaUser/SchemaUserMemory.schema';

export type McpSearchSource = 'notes' | 'notesWorkspace' | 'tasks' | 'taskWorkspace' | 'lifeEvents' | 'infoVault' | 'memo' | 'shortTermMemory';

export type McpSearchHit = {
    source: McpSearchSource;
    id: string;
    title: string;
    summary: string;
};

const STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why', 'how',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were',
    'be', 'been', 'am', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
    'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with', 'about', 'into', 'over', 'after',
    'my', 'me', 'i', 'you', 'your', 'our', 'we', 'us', 'please', 'help', 'need', 'want',
]);

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const keywordsFrom = (query: string): string[] =>
    Array.from(
        new Set(
            query
                .toLowerCase()
                .split(/[^a-z0-9]+/i)
                .map((t) => t.trim())
                .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
        )
    ).slice(0, 12);

const orFilters = (fields: string[], query: string): Record<string, unknown>[] => {
    const q = query.trim();
    if (!q) return [];
    const patterns = [new RegExp(escapeRegex(q), 'i')];
    for (const kw of keywordsFrom(q)) {
        patterns.push(new RegExp(escapeRegex(kw), 'i'));
    }
    const filters: Record<string, unknown>[] = [];
    for (const rx of patterns.slice(0, 8)) {
        for (const field of fields) {
            filters.push({ [field]: rx });
        }
    }
    return filters;
};

const ALL_SOURCES: McpSearchSource[] = ['notes', 'notesWorkspace', 'tasks', 'taskWorkspace', 'lifeEvents', 'infoVault', 'memo', 'shortTermMemory'];

export const parseMcpSearchSource = (raw: unknown): McpSearchSource | 'all' => {
    const value = typeof raw === 'string' ? raw.trim() : 'all';
    if (value === 'notes' || value === 'tasks' || value === 'lifeEvents' || value === 'infoVault' || value === 'memo') {
        return value;
    }
    return 'all';
};

export type McpSearchOptions = {
    limit?: number;
    offset?: number;
    sortBy?: 'updatedAt' | 'createdAt' | 'relevance';
    order?: 'asc' | 'desc';
    tags?: string[];
    createdAfter?: Date;
    createdBefore?: Date;
    updatedAfter?: Date;
    updatedBefore?: Date;
    prefixed?: Record<string, unknown>;
};

const buildDateFilter = (value: unknown, mode: string): Record<string, unknown> | null => {
    if (value === undefined || value === null || value === '') return null;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return null;
    if (mode === 'gte') return { $gte: d };
    if (mode === 'lte') return { $lte: d };
    if (mode === 'gt') return { $gt: d };
    if (mode === 'lt') return { $lt: d };
    if (mode === 'eq') {
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        return { $gte: d, $lt: next };
    }
    if (mode === 'exists') return { $exists: Boolean(value) };
    return { $gte: d };
};

export const mcpSearchSource = async ({
    userId,
    source,
    query,
    limit = 8,
    offset = 0,
    sortBy = 'updatedAt',
    order = 'desc',
    tags,
    createdAfter,
    createdBefore,
    updatedAfter,
    updatedBefore,
    prefixed = {},
}: {
    userId: mongoose.Types.ObjectId | string;
    source: McpSearchSource;
    query: string;
} & McpSearchOptions): Promise<McpSearchHit[]> => {
    const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const q = (query || '').trim().slice(0, 500);
    const fetchLimit = Math.min(Math.max(Math.trunc(limit), 1), 40);
    const skip = Math.min(Math.max(Math.trunc(offset ?? 0), 0), 1000);
    const filter: Record<string, unknown> = { userId: uid };
    const andClauses: Record<string, unknown>[] = [];

    // lean date ranges: single gte/lte per field
    const addDateRange = (field: string, gte?: Date, lte?: Date) => {
        const range: Record<string, unknown> = {};
        if (gte) range.$gte = gte;
        if (lte) range.$lte = lte;
        if (Object.keys(range).length) andClauses.push({ [field]: range });
    };
    addDateRange('createdAtUtc', createdAfter, createdBefore);
    addDateRange('updatedAtUtc', updatedAfter, updatedBefore);

    // tags filter (common)
    const tagFilter = (tags && tags.length ? tags.map((t) => new RegExp(`^${escapeRegex(t)}$`, 'i')) : null);

    const sortDir = order === 'asc' ? 1 : -1;
    const sortField = sortBy === 'createdAt' ? 'createdAtUtc' : 'updatedAtUtc';

    // helper to apply prefixed filters with AND
    const applyPrefixed = (prefix: string, fieldMap: Record<string, string>) => {
        for (const [key, val] of Object.entries(prefixed)) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length); // e.g., "title_regex" or "dueDate_gte"
            const lastUnd = rest.lastIndexOf('_');
            if (lastUnd === -1) continue;
            const fieldKey = rest.slice(0, lastUnd);
            const searchType = rest.slice(lastUnd + 1); // regex, exact, in, nin, gte, lte, gt, lt, eq, exists
            const mongoField = fieldMap[fieldKey];
            if (!mongoField) continue;
            if (val === undefined || val === null || val === '') continue;

            let clause: Record<string, unknown> | null = null;
            if (['regex', 'exact', 'in', 'nin'].includes(searchType)) {
                if (searchType === 'in' || searchType === 'nin') {
                    const arr = Array.isArray(val) ? val : [val];
                    const regs = arr.map((v) => new RegExp(`^${escapeRegex(String(v))}$`, 'i'));
                    clause = { [mongoField]: searchType === 'in' ? { $in: regs } : { $nin: regs } };
                } else if (searchType === 'exact') {
                    clause = { [mongoField]: new RegExp(`^${escapeRegex(String(val))}$`, 'i') };
                } else {
                    clause = { [mongoField]: new RegExp(escapeRegex(String(val)), 'i') };
                }
            } else if (['gte', 'lte', 'gt', 'lt', 'eq', 'exists'].includes(searchType)) {
                if (searchType === 'exists') {
                    clause = { [mongoField]: { $exists: Boolean(val) } };
                } else {
                    const d = new Date(String(val));
                    if (Number.isNaN(d.getTime())) continue;
                    if (searchType === 'eq') {
                        const next = new Date(d); next.setDate(next.getDate() + 1);
                        clause = { [mongoField]: { $gte: d, $lt: next } };
                    } else {
                        clause = { [mongoField]: { [`$${searchType}`]: d } };
                    }
                }
            } else if (searchType === 'exact' && typeof val === 'boolean') {
                clause = { [mongoField]: Boolean(val) };
            }
            if (clause) andClauses.push(clause);
        }
    };

    // Final filter builder - merge filter + andClauses + $or for text search
    const buildAndWrap = (baseOr: Record<string, unknown>[]) => {
        const finalAnd: Record<string, unknown>[] = [...andClauses];
        if (baseOr.length) finalAnd.push({ $or: baseOr });
        if (tagFilter) {
            // tags handled per source below, but keep common tags as AND
            const tOr = tagFilter.flatMap((rx) => [{ tags: rx }, { aiTags: rx }]);
            finalAnd.push({ $or: tOr });
        }
        const finalFilter: Record<string, unknown> = { ...filter };
        if (finalAnd.length) {
            // merge existing filter keys that are not $and
            if (finalAnd.length === 1 && Object.keys(filter).length === 1) {
                // just single clause
            }
            finalFilter.$and = finalAnd;
        }
        return finalFilter;
    };

    if (source === 'notes') {
        applyPrefixed('notes_', {
            title: 'title',
            description: 'description',
            isStar: 'isStar',
            workspaceId: 'notesWorkspaceId',
            tags: 'tags',
            createdAt: 'createdAtUtc',
            updatedAt: 'updatedAtUtc',
        });
        // Handle booleans and dates via prefixed
        for (const [k, v] of Object.entries(prefixed)) {
            if (k === 'notes_isStar_exact' && typeof v === 'boolean') andClauses.push({ isStar: v });
            if (k === 'notes_workspaceId_exact' && typeof v === 'string' && /^[a-f0-9]{24}$/i.test(String(v))) andClauses.push({ notesWorkspaceId: new mongoose.Types.ObjectId(String(v)) });
        }
        const or = orFilters(['title', 'description', 'aiSummary', 'tags', 'aiTags'], q);
        const finalFilter = buildAndWrap(or);
        // Handle in for tags via prefixed
        if (prefixed['notes_tags_in']) {
            const arr = prefixed['notes_tags_in'] as string[];
            const regs = (Array.isArray(arr) ? arr : []).map((s) => new RegExp(`^${escapeRegex(String(s))}$`, 'i'));
            if (regs.length) andClauses.push({ tags: { $in: regs } });
        }
        const docs = await ModelNotes.find(finalFilter)
            .sort({ [sortField]: sortDir })
            .skip(skip)
            .limit(fetchLimit)
            .select('_id title description aiSummary tags aiTags updatedAtUtc createdAtUtc isStar')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled note',
            summary: (d.aiSummary || d.description || '').slice(0, 500),
        }));
    }

    if (source === 'tasks') {
        // Prefixed string/date for tasks
        applyPrefixed('task_', {
            title: 'title',
            description: 'description',
            priority: 'priority',
            labels: 'labels',
        });
        for (const [k, v] of Object.entries(prefixed)) {
            if (!k.startsWith('task_')) continue;
            const rest = k.slice(5);
            if (rest === 'isCompleted_exact' && typeof v === 'boolean') andClauses.push({ isCompleted: v });
            if (rest === 'isArchived_exact' && typeof v === 'boolean') andClauses.push({ isArchived: v });
            if (rest === 'isPinned_exact' && typeof v === 'boolean') andClauses.push({ isTaskPinned: v });
            if (rest === 'workspaceId_exact' && typeof v === 'string' && /^[a-f0-9]{24}$/i.test(String(v))) andClauses.push({ taskWorkspaceId: new mongoose.Types.ObjectId(String(v)) });
            if (rest === 'statusId_exact' && typeof v === 'string' && /^[a-f0-9]{24}$/i.test(String(v))) andClauses.push({ taskStatusId: new mongoose.Types.ObjectId(String(v)) });
            if (rest.startsWith('dueDate_') && typeof v === 'string') {
                const mode = rest.split('_').pop()!;
                const f = buildDateFilter(v, mode);
                if (f) andClauses.push({ dueDate: f });
            }
        }
        const or = orFilters(['title', 'description', 'labels', 'labelsAi'], q);
        const finalFilter = buildAndWrap(or);
        const docs = await ModelTask.find(finalFilter)
            .sort({ [sortField]: sortDir })
            .skip(skip)
            .limit(fetchLimit)
            .select('_id title description isCompleted isArchived isTaskPinned priority dueDate labels updatedAtUtc createdAtUtc')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled task',
            summary: `${d.isCompleted ? '[done] ' : '[open] '}${(d.description || '').slice(0, 500)}`,
        }));
    }

    if (source === 'lifeEvents') {
        applyPrefixed('lifeEvents_', {
            title: 'title',
            description: 'description',
            isStar: 'isStar',
            eventImpact: 'eventImpact',
            categoryId: 'categoryId',
            year: 'eventDateYearStr',
            yearMonth: 'eventDateYearMonthStr',
        });
        for (const [k, v] of Object.entries(prefixed)) {
            if (!k.startsWith('lifeEvents_')) continue;
            const rest = k.slice(11);
            if (rest === 'isStar_exact' && typeof v === 'boolean') andClauses.push({ isStar: v });
            if (rest === 'eventImpact_exact' && typeof v === 'string') andClauses.push({ eventImpact: v });
            if (rest === 'eventImpact_in' && Array.isArray(v)) andClauses.push({ eventImpact: { $in: v } });
            if (rest === 'year_exact' && typeof v === 'string') andClauses.push({ eventDateYearStr: String(v) });
            if (rest === 'yearMonth_exact' && typeof v === 'string') andClauses.push({ eventDateYearMonthStr: String(v) });
            if (rest === 'categoryId_exact' && typeof v === 'string' && /^[a-f0-9]{24}$/i.test(String(v))) andClauses.push({ categoryId: new mongoose.Types.ObjectId(String(v)) });
            if (rest.startsWith('eventDate_') && typeof v === 'string') {
                const mode = rest.split('_').pop()!;
                const f = buildDateFilter(v, mode);
                if (f) andClauses.push({ eventDateUtc: f });
            }
        }
        const or = orFilters(['title', 'description'], q);
        const finalFilter = buildAndWrap(or);
        const docs = await ModelLifeEvents.find(finalFilter)
            .sort({ [sortField]: sortDir })
            .skip(skip)
            .limit(fetchLimit)
            .select('_id title description eventImpact eventDateUtc eventDateYearStr isStar updatedAtUtc createdAtUtc')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled life event',
            summary: `[${d.eventImpact || 'n/a'}] ${(d.description || '').slice(0, 500)}`,
        }));
    }

    if (source === 'memo') {
        const memoArchived = prefixed['memo_archived_exact'] as boolean | undefined;
        const memoPinned = prefixed['memo_pinned_exact'] as boolean | undefined;
        const memoTrashed = prefixed['memo_trashed_exact'] as boolean | undefined;
        if (memoTrashed === true) {
            // include trashed, do not filter
        } else if (memoTrashed === false) {
            andClauses.push({ trashed: { $ne: true } });
        } else {
            andClauses.push({ trashed: { $ne: true } });
        }
        if (memoArchived === true) {
            // include archived, no filter
        } else if (memoArchived === false) {
            andClauses.push({ archived: { $ne: true } });
        } else {
            andClauses.push({ archived: { $ne: true } });
        }
        if (typeof memoPinned === 'boolean') andClauses.push({ pinned: memoPinned });
        applyPrefixed('memo_', {
            title: 'title',
            body: 'body',
            noteColor: 'noteColor',
        });
        for (const [k, v] of Object.entries(prefixed)) {
            if (k === 'memo_labelIds_in' && Array.isArray(v)) {
                const ids = (v as string[]).filter((s) => /^[a-f0-9]{24}$/i.test(String(s))).map((s) => new mongoose.Types.ObjectId(String(s)));
                if (ids.length) andClauses.push({ labelIds: { $in: ids } });
            }
            if (k === 'memo_noteColor_exact' && typeof v === 'string') andClauses.push({ noteColor: v });
            if (k === 'memo_noteColor_in' && Array.isArray(v)) andClauses.push({ noteColor: { $in: v } });
        }
        const or = orFilters(['title', 'body'], q);
        const finalFilter = buildAndWrap(or);
        const docs = await ModelMemoNote.find(finalFilter)
            .sort({ [sortField]: sortDir })
            .skip(skip)
            .limit(fetchLimit)
            .select('_id title body pinned archived trashed noteColor updatedAtUtc createdAtUtc')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled memo',
            summary: `${d.pinned ? '[pinned] ' : ''}${(d.body || '').slice(0, 500)}`,
        }));
    }

    if (source === 'notesWorkspace') {
        applyPrefixed('notesWorkspace_', {
            title: 'title',
            description: 'description',
            isStar: 'isStar',
            workspaceId: 'notesWorkspaceId',
            tags: 'tags',
        });
        for (const [k, v] of Object.entries(prefixed)) {
            if (k === 'notesWorkspace_isStar_exact' && typeof v === 'boolean') andClauses.push({ isStar: v });
            if (k === 'notesWorkspace_workspaceId_exact' && typeof v === 'string' && /^[a-f0-9]{24}$/i.test(String(v))) andClauses.push({ _id: new mongoose.Types.ObjectId(String(v)) });
        }
        const or = orFilters(['title', 'description', 'aiSummary', 'tags', 'aiTags'], q);
        const finalFilter = buildAndWrap(or);
        const docs = await ModelNotesWorkspace.find(finalFilter)
            .sort({ [sortField]: sortDir })
            .skip(skip)
            .limit(fetchLimit)
            .select('_id title description isStar tags aiSummary updatedAtUtc createdAtUtc')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled notes workspace',
            summary: (d.aiSummary || d.description || '').slice(0, 500),
        }));
    }

    if (source === 'taskWorkspace') {
        applyPrefixed('taskWorkspace_', {
            title: 'title',
            description: 'description',
            isStar: 'isStar',
            tags: 'tags',
        });
        for (const [k, v] of Object.entries(prefixed)) {
            if (k === 'taskWorkspace_isStar_exact' && typeof v === 'boolean') andClauses.push({ isStar: v });
        }
        const or = orFilters(['title', 'description', 'aiSummary', 'tags', 'aiTags'], q);
        const finalFilter = buildAndWrap(or);
        const docs = await ModelTaskWorkspace.find(finalFilter)
            .sort({ [sortField]: sortDir })
            .skip(skip)
            .limit(fetchLimit)
            .select('_id title description isStar tags aiSummary updatedAtUtc createdAtUtc')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled task workspace',
            summary: (d.aiSummary || d.description || '').slice(0, 500),
        }));
    }

    if (source === 'shortTermMemory') {
        // short term = isPermanent false
        andClauses.push({ isPermanent: false });
        const or = orFilters(['content'], q);
        // handle prefixed for shortTermMemory: content, isPermanent, createdAt etc handled via common
        for (const [k, v] of Object.entries(prefixed)) {
            if (k === 'shortTermMemory_content_regex' && typeof v === 'string') andClauses.push({ content: new RegExp(escapeRegex(String(v)), 'i') });
            if (k === 'shortTermMemory_content_exact' && typeof v === 'string') andClauses.push({ content: new RegExp(`^${escapeRegex(String(v))}$`, 'i') });
            if (k === 'shortTermMemory_isPermanent_exact' && typeof v === 'boolean') andClauses.push({ isPermanent: v });
        }
        const finalFilter = buildAndWrap(or);
        const docs = await ModelUserMemory.find(finalFilter)
            .sort({ [sortField]: sortDir })
            .skip(skip)
            .limit(fetchLimit)
            .select('_id content isPermanent updatedAtUtc createdAtUtc')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: (d.content || '').slice(0, 50) || 'Untitled memory',
            summary: (d.content || '').slice(0, 500),
        }));
    }

    // infoVault
    const vaultArchived = prefixed['infoVault_isArchived_exact'] as boolean | undefined;
    if (vaultArchived === true) {
        // include
    } else if (vaultArchived === false) {
        andClauses.push({ isArchived: { $ne: true } });
    } else {
        andClauses.push({ isArchived: { $ne: true } });
    }
    for (const [k, v] of Object.entries(prefixed)) {
        if (k === 'infoVault_isFavorite_exact' && typeof v === 'boolean') andClauses.push({ isFavorite: v });
        if (k === 'infoVault_isBlocked_exact' && typeof v === 'boolean') andClauses.push({ isBlocked: v });
        if (k === 'infoVault_type_exact' && typeof v === 'string') andClauses.push({ infoVaultType: v });
        if (k === 'infoVault_relationshipType_exact' && typeof v === 'string') andClauses.push({ relationshipType: v });
        if (k === 'infoVault_lastContact_gte' && typeof v === 'string') {
            const f = buildDateFilter(v, 'gte');
            if (f) andClauses.push({ lastContactDate: f });
        }
        if (k === 'infoVault_lastContact_lte' && typeof v === 'string') {
            const f = buildDateFilter(v, 'lte');
            if (f) andClauses.push({ lastContactDate: f });
        }
    }
    applyPrefixed('infoVault_', {
        name: 'name',
        company: 'company',
        type: 'infoVaultType',
        isFavorite: 'isFavorite',
        isBlocked: 'isBlocked',
    });
    const or = orFilters(['name', 'nickname', 'company', 'notes', 'tags', 'aiSummary', 'aiTags'], q);
    const finalFilter = buildAndWrap(or);
    const docs = await ModelInfoVault.find(finalFilter)
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(fetchLimit)
        .select('_id name nickname company notes aiSummary tags isFavorite isBlocked updatedAtUtc createdAtUtc')
        .lean();
    return docs.map((d) => ({
        source,
        id: String(d._id),
        title: d.name || d.nickname || 'Untitled info vault',
        summary: (d.aiSummary || d.notes || d.company || '').slice(0, 500),
    }));
};

export const mcpSearchAll = async ({
    userId,
    query,
    limitPerSource = 6,
    offset,
    sortBy,
    order,
    tags,
    createdAfter,
    createdBefore,
    updatedAfter,
    updatedBefore,
    prefixed,
}: {
    userId: mongoose.Types.ObjectId | string;
    query: string;
    limitPerSource?: number;
} & McpSearchOptions): Promise<McpSearchHit[]> => {
    const results = await Promise.all(
        ALL_SOURCES.map((source) =>
            mcpSearchSource({
                userId,
                source,
                query,
                limit: limitPerSource,
                offset,
                sortBy,
                order,
                tags,
                createdAfter,
                createdBefore,
                updatedAfter,
                updatedBefore,
                prefixed,
            })
        )
    );
    const seen = new Set<string>();
    const hits: McpSearchHit[] = [];
    for (const hit of results.flat()) {
        const key = `${hit.source}:${hit.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push(hit);
    }
    return hits;
};
