/**
 * Compact personal context + user memories for the agent context window.
 * Honors thread flags (isPersonalContextEnabled / isMemoryEnabled).
 * Attached notes/tasks/etc. are title + short snippet only — search tools for more.
 */
import mongoose from 'mongoose';

import { ModelChatLlmThread } from '../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelChatLlmThreadContextReference } from '../../../../../schema/schemaChatLlm/SchemaChatLlmThreadContextReference.schema';
import { ModelUser } from '../../../../../schema/schemaUser/SchemaUser.schema';
import { ModelUserMemory } from '../../../../../schema/schemaUser/SchemaUserMemory.schema';
import { ModelNotes } from '../../../../../schema/schemaNotes/SchemaNotes.schema';
import { ModelTask } from '../../../../../schema/schemaTask/SchemaTask.schema';
import { ModelLifeEvents } from '../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelMemoNote } from '../../../../../schema/schemaMemo/SchemaMemoNote.schema';
import { ModelInfoVault } from '../../../../../schema/schemaInfoVault/SchemaInfoVault.schema';

const ATTACHED_ITEM_LIMIT = 20;
const SNIPPET_CHARS = 240;
const SECTION_CHARS = 4000;

const clip = (text: string, max: number): string => {
    const s = (text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, Math.max(0, max - 1))}…`;
};

const stripHtml = (html: string): string =>
    clip(String(html || '').replace(/<[^>]+>/g, ' '), SNIPPET_CHARS);

export type AgentPersonalContextSections = {
    personalProfile: string;
    userMemories: string;
    attachedContext: string;
};

const loadPersonalProfile = async (userId: mongoose.Types.ObjectId): Promise<string> => {
    const user = await ModelUser.findById(userId)
        .select('name dateOfBirth city state country zipCode languages bio')
        .lean();
    if (!user) return '';
    const bits: string[] = [];
    if (user.name) bits.push(`Name: ${user.name}`);
    if (user.dateOfBirth) bits.push(`Born: ${user.dateOfBirth}`);
    const loc = [user.city, user.state, user.country, user.zipCode].filter(Boolean).join(', ');
    if (loc) bits.push(`Location: ${loc}`);
    if (Array.isArray(user.languages) && user.languages.length) {
        bits.push(`Languages: ${user.languages.join(', ')}`);
    }
    if (user.bio) bits.push(`Bio: ${clip(user.bio, 400)}`);
    bits.push(`Current date and time: ${new Date().toLocaleString()}`);
    return bits.join('\n');
};

const loadUserMemories = async (userId: mongoose.Types.ObjectId): Promise<string> => {
    const user = await ModelUser.findById(userId)
        .select('isStoreUserMemoriesEnabled userMemoriesLimit')
        .lean();
    if (!user?.isStoreUserMemoriesEnabled) return '';
    const limit = Math.min(40, Math.max(1, Number(user.userMemoriesLimit) || 15));
    const memories = await ModelUserMemory.find({ userId })
        .sort({ updatedAtUtc: -1 })
        .limit(limit)
        .select('content')
        .lean();
    if (!memories.length) return '';
    return memories
        .map((m, i) => `${i + 1}. ${clip(m.content || '', 300)}`)
        .join('\n');
};

const idsFor = (
    refs: Array<{ referenceFrom?: string; referenceId?: mongoose.Types.ObjectId | null }>,
    from: string
): mongoose.Types.ObjectId[] =>
    refs
        .filter((r) => r.referenceFrom === from && r.referenceId)
        .map((r) => r.referenceId as mongoose.Types.ObjectId)
        .slice(0, ATTACHED_ITEM_LIMIT);

const loadAttachedContext = async (params: {
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
}): Promise<string> => {
    const refs = await ModelChatLlmThreadContextReference.find({
        userId: params.userId,
        threadId: params.threadId,
        referenceId: { $ne: null },
    })
        .select('referenceFrom referenceId')
        .lean();
    if (!refs.length) return '';

    const noteIds = idsFor(refs, 'notes');
    const taskIds = idsFor(refs, 'tasks');
    const lifeIds = idsFor(refs, 'lifeEvents');
    const memoIds = idsFor(refs, 'memo');
    const vaultIds = idsFor(refs, 'infoVault');

    const [notes, tasks, lifeEvents, memos, vaults] = await Promise.all([
        noteIds.length
            ? ModelNotes.find({ _id: { $in: noteIds }, userId: params.userId })
                  .select('title description')
                  .lean()
            : [],
        taskIds.length
            ? ModelTask.find({ _id: { $in: taskIds }, userId: params.userId })
                  .select('title description isCompleted dueDate priority')
                  .lean()
            : [],
        lifeIds.length
            ? ModelLifeEvents.find({ _id: { $in: lifeIds }, userId: params.userId })
                  .select('title description eventDateUtc aiSummary')
                  .lean()
            : [],
        memoIds.length
            ? ModelMemoNote.find({
                  _id: { $in: memoIds },
                  userId: params.userId,
                  trashed: false,
              })
                  .select('title body')
                  .lean()
            : [],
        vaultIds.length
            ? ModelInfoVault.find({ _id: { $in: vaultIds }, userId: params.userId })
                  .select('name nickname company jobTitle notes aiSummary')
                  .lean()
            : [],
    ]);

    const lines: string[] = [];
    for (const n of notes) {
        lines.push(`- [note] ${clip(n.title || 'Untitled', 120)}${n.description ? ` — ${stripHtml(n.description)}` : ''}`);
    }
    for (const t of tasks) {
        const done = t.isCompleted ? 'done' : 'open';
        const due = t.dueDate ? `due ${new Date(t.dueDate).toISOString().slice(0, 10)}` : '';
        const extra = [done, t.priority ? `priority ${t.priority}` : '', due].filter(Boolean).join(', ');
        lines.push(
            `- [task] ${clip(t.title || 'Untitled', 120)} (${extra})${t.description ? ` — ${clip(t.description, SNIPPET_CHARS)}` : ''}`
        );
    }
    for (const e of lifeEvents) {
        const when = e.eventDateUtc ? new Date(e.eventDateUtc).toISOString().slice(0, 10) : '';
        const body = e.aiSummary || e.description || '';
        lines.push(
            `- [lifeEvent] ${clip(e.title || 'Untitled', 120)}${when ? ` (${when})` : ''}${body ? ` — ${stripHtml(body)}` : ''}`
        );
    }
    for (const m of memos) {
        lines.push(`- [memo] ${clip(m.title || 'Untitled', 120)}${m.body ? ` — ${clip(m.body, SNIPPET_CHARS)}` : ''}`);
    }
    for (const v of vaults) {
        const label = [v.name, v.nickname, v.jobTitle, v.company].filter(Boolean).join(' / ');
        const body = v.aiSummary || v.notes || '';
        lines.push(`- [infoVault] ${clip(label || 'Contact', 120)}${body ? ` — ${clip(body, SNIPPET_CHARS)}` : ''}`);
    }

    if (!lines.length) return '';
    return clip(lines.join('\n'), SECTION_CHARS);
};

export const loadAgentPersonalContextSections = async (params: {
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
}): Promise<AgentPersonalContextSections> => {
    const empty: AgentPersonalContextSections = {
        personalProfile: '',
        userMemories: '',
        attachedContext: '',
    };
    try {
        const thread = await ModelChatLlmThread.findById(params.threadId)
            .select('isPersonalContextEnabled isMemoryEnabled')
            .lean();
        if (!thread) return empty;

        const [personalProfile, userMemories, attachedContext] = await Promise.all([
            thread.isPersonalContextEnabled ? loadPersonalProfile(params.userId) : Promise.resolve(''),
            thread.isMemoryEnabled ? loadUserMemories(params.userId) : Promise.resolve(''),
            thread.isPersonalContextEnabled
                ? loadAttachedContext({ userId: params.userId, threadId: params.threadId })
                : Promise.resolve(''),
        ]);

        return { personalProfile, userMemories, attachedContext };
    } catch (err) {
        console.warn('loadAgentPersonalContextSections failed:', err);
        return empty;
    }
};
