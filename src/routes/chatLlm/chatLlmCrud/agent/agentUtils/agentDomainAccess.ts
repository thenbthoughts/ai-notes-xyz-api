import mongoose from 'mongoose';

import { ModelNotes } from '../../../../../schema/schemaNotes/SchemaNotes.schema';
import { ModelTask } from '../../../../../schema/schemaTask/SchemaTask.schema';
import { ModelLifeEvents } from '../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelInfoVault } from '../../../../../schema/schemaInfoVault/SchemaInfoVault.schema';
import { ModelMemoNote } from '../../../../../schema/schemaMemo/SchemaMemoNote.schema';

const STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why', 'how',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were',
    'be', 'been', 'been', 'am', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
    'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with', 'about', 'into', 'over', 'after',
    'my', 'me', 'i', 'you', 'your', 'our', 'we', 'us', 'please', 'help', 'need', 'want',
]);

const escapeRegex = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Extract searchable keywords from a natural-language prompt. */
export const extractSearchKeywords = (query: string): string[] => {
    const tokens = query
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    const unique = Array.from(new Set(tokens));
    return unique.slice(0, 12);
};

const buildOrRegexFilters = (fields: string[], query: string): Record<string, unknown>[] => {
    const q = query.trim();
    if (!q) return [];

    const keywords = extractSearchKeywords(q);
    const patterns: RegExp[] = [];

    // Full phrase first (highest precision)
    patterns.push(new RegExp(escapeRegex(q), 'i'));

    // Individual keywords for broad prompts like "how to improve my life"
    for (const kw of keywords) {
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

export type AgentDomainSearchSource = 'notes' | 'tasks' | 'lifeEvents' | 'infoVault' | 'memo';

export interface AgentDomainHit {
    source: AgentDomainSearchSource;
    id: string;
    title: string;
    summary: string;
    score?: number;
}

/** Score a hit for relevance: title matches outweigh body; recency is a tie-breaker. */
export const scoreAgentDomainHit = (
    hit: AgentDomainHit,
    query: string,
    indexInResult: number
): number => {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
        return Math.max(0, 50 - indexInResult);
    }
    const keywords = extractSearchKeywords(q);
    const title = (hit.title || '').toLowerCase();
    const body = (hit.summary || '').toLowerCase();
    let score = 0;

    if (title.includes(q)) score += 100;
    else if (q.length >= 6 && title.includes(q.slice(0, Math.min(q.length, 40)))) score += 60;

    for (const kw of keywords) {
        if (title.includes(kw)) score += 25;
        if (body.includes(kw)) score += 8;
    }

    // Prefer earlier (more recent) Mongo results slightly when scores tie
    score += Math.max(0, 10 - indexInResult);
    return score;
};

const rankDomainHits = (hits: AgentDomainHit[], query: string, limit: number): AgentDomainHit[] => {
    const scored = hits.map((h, i) => ({
        ...h,
        score: scoreAgentDomainHit(h, query, i),
    }));
    scored.sort((a, b) => (b.score || 0) - (a.score || 0));
    return scored.slice(0, limit);
};

const ALL_SOURCES: AgentDomainSearchSource[] = ['notes', 'tasks', 'lifeEvents', 'infoVault', 'memo'];

export const searchAgentDomain = async ({
    userId,
    source,
    query,
    limit = 8,
}: {
    userId: mongoose.Types.ObjectId | string;
    source: AgentDomainSearchSource;
    query: string;
    limit?: number;
}): Promise<AgentDomainHit[]> => {
    const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const q = (query || '').trim();
    // Fetch extra candidates so ranking can promote title matches over pure recency
    const fetchLimit = Math.min(Math.max(limit * 3, limit), 40);

    let mapped: AgentDomainHit[] = [];

    if (source === 'notes') {
        const filter: Record<string, unknown> = { userId: uid };
        const or = buildOrRegexFilters(['title', 'description', 'aiSummary', 'tags', 'aiTags'], q);
        if (or.length) filter.$or = or;
        const docs = await ModelNotes.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(fetchLimit)
            .select('_id title description aiSummary')
            .lean();
        mapped = docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled note',
            summary: (d.aiSummary || d.description || '').slice(0, 500),
        }));
    } else if (source === 'tasks') {
        const filter: Record<string, unknown> = { userId: uid };
        const or = buildOrRegexFilters(['title', 'description', 'labels', 'labelsAi'], q);
        if (or.length) filter.$or = or;
        const docs = await ModelTask.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(fetchLimit)
            .select('_id title description isCompleted')
            .lean();
        mapped = docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled task',
            summary: `${d.isCompleted ? '[done] ' : '[open] '}${(d.description || '').slice(0, 500)}`,
        }));
    } else if (source === 'lifeEvents') {
        const filter: Record<string, unknown> = { userId: uid };
        const or = buildOrRegexFilters(['title', 'description'], q);
        if (or.length) filter.$or = or;
        const docs = await ModelLifeEvents.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(fetchLimit)
            .select('_id title description eventImpact')
            .lean();
        mapped = docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled life event',
            summary: `[${d.eventImpact || 'n/a'}] ${(d.description || '').slice(0, 500)}`,
        }));
    } else if (source === 'memo') {
        const filter: Record<string, unknown> = {
            userId: uid,
            trashed: { $ne: true },
            archived: { $ne: true },
        };
        const or = buildOrRegexFilters(['title', 'body'], q);
        if (or.length) filter.$or = or;
        const docs = await ModelMemoNote.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(fetchLimit)
            .select('_id title body pinned')
            .lean();
        mapped = docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled memo',
            summary: `${d.pinned ? '[pinned] ' : ''}${(d.body || '').slice(0, 500)}`,
        }));
    } else {
        const filter: Record<string, unknown> = { userId: uid, isArchived: { $ne: true } };
        const or = buildOrRegexFilters(
            ['name', 'nickname', 'company', 'notes', 'tags', 'aiSummary', 'aiTags'],
            q
        );
        if (or.length) filter.$or = or;
        const docs = await ModelInfoVault.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(fetchLimit)
            .select('_id name nickname company notes aiSummary')
            .lean();
        mapped = docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.name || d.nickname || 'Untitled info vault',
            summary: (d.aiSummary || d.notes || d.company || '').slice(0, 500),
        }));
    }

    return rankDomainHits(mapped, q, limit);
};

/**
 * Search notes, tasks, life events, info vault, and memos in parallel.
 * Broad prompts (few keywords) also pull recent docs so life-advice queries
 * still get personal context.
 */
export const searchAllAgentDomains = async ({
    userId,
    query,
    limitPerSource = 6,
}: {
    userId: mongoose.Types.ObjectId | string;
    query: string;
    limitPerSource?: number;
}): Promise<AgentDomainHit[]> => {
    const keywords = extractSearchKeywords(query);
    const isBroad = keywords.length <= 2;

    const results = await Promise.all(
        ALL_SOURCES.map((source) =>
            searchAgentDomain({
                userId,
                source,
                query: isBroad && keywords.length === 0 ? '' : query,
                limit: limitPerSource,
            })
        )
    );

    let hits = results.flat();

    // If keyword search was too narrow, top up with recent docs per empty domain
    if (hits.length < 4 && query.trim()) {
        const present = new Set(hits.map((h) => h.source));
        const topUps = await Promise.all(
            ALL_SOURCES.filter((s) => !present.has(s)).map((source) =>
                searchAgentDomain({ userId, source, query: '', limit: Math.min(4, limitPerSource) })
            )
        );
        hits = [...hits, ...topUps.flat()];
    }

    // Dedupe by source+id
    const seen = new Set<string>();
    const deduped: AgentDomainHit[] = [];
    for (const h of hits) {
        const key = `${h.source}:${h.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(h);
    }
    return rankDomainHits(deduped, query, limitPerSource * ALL_SOURCES.length);
};
