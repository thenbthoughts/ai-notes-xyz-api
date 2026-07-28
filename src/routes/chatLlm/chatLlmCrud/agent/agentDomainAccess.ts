import mongoose from 'mongoose';

import { ModelNotes } from '../../../../schema/schemaNotes/SchemaNotes.schema';
import { ModelTask } from '../../../../schema/schemaTask/SchemaTask.schema';
import { ModelLifeEvents } from '../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelInfoVault } from '../../../../schema/schemaInfoVault/SchemaInfoVault.schema';

const escapeRegex = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildTextFilter = (query: string) => {
    const q = query.trim();
    if (!q) {
        return {};
    }
    const rx = new RegExp(escapeRegex(q), 'i');
    return rx;
};

export type AgentDomainSearchSource = 'notes' | 'tasks' | 'lifeEvents' | 'infoVault';

export interface AgentDomainHit {
    source: AgentDomainSearchSource;
    id: string;
    title: string;
    summary: string;
}

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
    const rx = buildTextFilter(query);
    const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    if (source === 'notes') {
        const filter: Record<string, unknown> = { userId: uid };
        if (rx instanceof RegExp) {
            filter.$or = [
                { title: rx },
                { description: rx },
                { aiSummary: rx },
                { tags: rx },
                { aiTags: rx },
            ];
        }
        const docs = await ModelNotes.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(limit)
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
        const filter: Record<string, unknown> = { userId: uid };
        if (rx instanceof RegExp) {
            filter.$or = [
                { title: rx },
                { description: rx },
                { labels: rx },
                { labelsAi: rx },
            ];
        }
        const docs = await ModelTask.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(limit)
            .select('_id title description isCompleted')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled task',
            summary: `${d.isCompleted ? '[done] ' : ''}${(d.description || '').slice(0, 500)}`,
        }));
    }

    if (source === 'lifeEvents') {
        const filter: Record<string, unknown> = { userId: uid };
        if (rx instanceof RegExp) {
            filter.$or = [
                { title: rx },
                { description: rx },
            ];
        }
        const docs = await ModelLifeEvents.find(filter)
            .sort({ updatedAtUtc: -1 })
            .limit(limit)
            .select('_id title description eventImpact')
            .lean();
        return docs.map((d) => ({
            source,
            id: String(d._id),
            title: d.title || 'Untitled life event',
            summary: `[${d.eventImpact || 'n/a'}] ${(d.description || '').slice(0, 500)}`,
        }));
    }

    // infoVault
    const filter: Record<string, unknown> = { userId: uid, isArchived: { $ne: true } };
    if (rx instanceof RegExp) {
        filter.$or = [
            { name: rx },
            { nickname: rx },
            { company: rx },
            { notes: rx },
            { tags: rx },
            { aiSummary: rx },
            { aiTags: rx },
        ];
    }
    const docs = await ModelInfoVault.find(filter)
        .sort({ updatedAtUtc: -1 })
        .limit(limit)
        .select('_id name nickname company notes aiSummary')
        .lean();
    return docs.map((d) => ({
        source,
        id: String(d._id),
        title: d.name || d.nickname || 'Untitled info vault',
        summary: (d.aiSummary || d.notes || d.company || '').slice(0, 500),
    }));
};
