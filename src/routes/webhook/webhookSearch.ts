import mongoose from 'mongoose';

import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { ModelLifeEvents } from '../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';
import { ModelMemoNote } from '../../schema/schemaMemo/SchemaMemoNote.schema';

export type WebhookSearchSource = 'notes' | 'tasks' | 'lifeEvents' | 'infoVault' | 'memo';

export type WebhookSearchHit = {
    source: WebhookSearchSource;
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

const ALL_SOURCES: WebhookSearchSource[] = ['notes', 'tasks', 'lifeEvents', 'infoVault', 'memo'];

export const parseWebhookSearchSource = (raw: unknown): WebhookSearchSource | 'all' => {
    const value = typeof raw === 'string' ? raw.trim() : 'all';
    if (value === 'notes' || value === 'tasks' || value === 'lifeEvents' || value === 'infoVault' || value === 'memo') {
        return value;
    }
    return 'all';
};

export const webhookSearchSource = async ({
    userId,
    source,
    query,
    limit = 8,
}: {
    userId: mongoose.Types.ObjectId | string;
    source: WebhookSearchSource;
    query: string;
    limit?: number;
}): Promise<WebhookSearchHit[]> => {
    const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const q = (query || '').trim();
    const fetchLimit = Math.min(Math.max(limit, 1), 40);
    const filter: Record<string, unknown> = { userId: uid };

    if (source === 'notes') {
        const or = orFilters(['title', 'description', 'aiSummary', 'tags', 'aiTags'], q);
        if (or.length) filter.$or = or;
        const docs = await ModelNotes.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(fetchLimit)
            .select('_id title description aiSummary')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled note',
            summary: (d.aiSummary || d.description || '').slice(0, 500),
        }));
    }

    if (source === 'tasks') {
        const or = orFilters(['title', 'description', 'labels', 'labelsAi'], q);
        if (or.length) filter.$or = or;
        const docs = await ModelTask.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(fetchLimit)
            .select('_id title description isCompleted')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled task',
            summary: `${d.isCompleted ? '[done] ' : '[open] '}${(d.description || '').slice(0, 500)}`,
        }));
    }

    if (source === 'lifeEvents') {
        const or = orFilters(['title', 'description'], q);
        if (or.length) filter.$or = or;
        const docs = await ModelLifeEvents.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(fetchLimit)
            .select('_id title description eventImpact')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled life event',
            summary: `[${d.eventImpact || 'n/a'}] ${(d.description || '').slice(0, 500)}`,
        }));
    }

    if (source === 'memo') {
        filter.trashed = { $ne: true };
        filter.archived = { $ne: true };
        const or = orFilters(['title', 'body'], q);
        if (or.length) filter.$or = or;
        const docs = await ModelMemoNote.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(fetchLimit)
            .select('_id title body pinned')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled memo',
            summary: `${d.pinned ? '[pinned] ' : ''}${(d.body || '').slice(0, 500)}`,
        }));
    }

    filter.isArchived = { $ne: true };
    const or = orFilters(['name', 'nickname', 'company', 'notes', 'tags', 'aiSummary', 'aiTags'], q);
    if (or.length) filter.$or = or;
    const docs = await ModelInfoVault.find(filter)
        .sort({ updatedAtUtc: -1 })
        .limit(fetchLimit)
        .select('_id name nickname company notes aiSummary')
        .lean();
    return docs.map((d) => ({
        source,
        id: String(d._id),
        title: d.name || d.nickname || 'Untitled info vault',
        summary: (d.aiSummary || d.notes || d.company || '').slice(0, 500),
    }));
};

export const webhookSearchAll = async ({
    userId,
    query,
    limitPerSource = 6,
}: {
    userId: mongoose.Types.ObjectId | string;
    query: string;
    limitPerSource?: number;
}): Promise<WebhookSearchHit[]> => {
    const results = await Promise.all(
        ALL_SOURCES.map((source) =>
            webhookSearchSource({
                userId,
                source,
                query,
                limit: limitPerSource,
            })
        )
    );
    const seen = new Set<string>();
    const hits: WebhookSearchHit[] = [];
    for (const hit of results.flat()) {
        const key = `${hit.source}:${hit.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push(hit);
    }
    return hits;
};
