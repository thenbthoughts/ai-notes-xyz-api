import mongoose from 'mongoose';

import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { ModelNotesWorkspace } from '../../schema/schemaNotes/SchemaNotesWorkspace.schema';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { ModelTaskWorkspace } from '../../schema/schemaTask/SchemaTaskWorkspace.schema';
import { ModelMemoNote } from '../../schema/schemaMemo/SchemaMemoNote.schema';
import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';
import { ModelLifeEvents } from '../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelUserMemory } from '../../schema/schemaUser/SchemaUserMemory.schema';

export type UserLibraryCounts = {
    notes: number;
    notesWorkspace: number;
    tasks: number;
    taskWorkspace: number;
    memos: number;
    infoVault: number;
    lifeEvents: number;
    shortTermMemory: number;
    total: number;
};

export const getUserLibraryCounts = async (
    userId: mongoose.Types.ObjectId | string
): Promise<UserLibraryCounts> => {
    const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const [notes, notesWorkspace, tasks, taskWorkspace, memos, infoVault, lifeEvents, shortTermMemory] = await Promise.all([
        ModelNotes.countDocuments({ userId: uid }),
        ModelNotesWorkspace.countDocuments({ userId: uid }),
        ModelTask.countDocuments({ userId: uid }),
        ModelTaskWorkspace.countDocuments({ userId: uid }),
        ModelMemoNote.countDocuments({
            userId: uid,
            trashed: { $ne: true },
            archived: { $ne: true },
        }),
        ModelInfoVault.countDocuments({ userId: uid, isArchived: { $ne: true } }),
        ModelLifeEvents.countDocuments({ userId: uid }),
        ModelUserMemory.countDocuments({ userId: uid, isPermanent: false }),
    ]);
    return {
        notes,
        notesWorkspace,
        tasks,
        taskWorkspace,
        memos,
        infoVault,
        lifeEvents,
        shortTermMemory,
        total: notes + notesWorkspace + tasks + taskWorkspace + memos + infoVault + lifeEvents + shortTermMemory,
    };
};

export const formatUserLibraryCountsLine = (counts: UserLibraryCounts): string =>
    `${counts.notes} notes (${counts.notesWorkspace} workspaces), ${counts.tasks} tasks (${counts.taskWorkspace} workspaces), ${counts.memos} memos, ${counts.infoVault} info vault records, ${counts.lifeEvents} life events, ${counts.shortTermMemory} short-term memories`;

export const buildUserLibraryMcpContext = (counts: UserLibraryCounts): string => {
    const lines = [
        '## User library',
        `This signed-in user currently has ${counts.total} private records:`,
        `- notes: ${counts.notes} (workspaces: ${counts.notesWorkspace})`,
        `- tasks: ${counts.tasks} (workspaces: ${counts.taskWorkspace})`,
        `- memos: ${counts.memos}`,
        `- info vault: ${counts.infoVault}`,
        `- life events: ${counts.lifeEvents}`,
        `- short-term memory: ${counts.shortTermMemory}`,
        '',
        'MCP tools (already configured in opencode.json):',
        '- search — args: query/search (keywords), source (all | notes | notesWorkspace | tasks | taskWorkspace | lifeEvents | memo | infoVault | shortTermMemory), page/perPage or limit/offset, sortBy/order, createdAt_gte/lte, updatedAt_gte/lte, tags, plus per-field task_/notes_/memo_/lifeEvents_/infoVault_/notesWorkspace_/taskWorkspace_/shortTermMemory_ filters with suffix regex/exact/in and date gte/lte (e.g., task_title_regex, task_dueDate_gte, notes_isStar_exact, memo_pinned_exact). All filters combine with AND. Empty query returns recent items.',
        '- add_chat_file — attach a file to this chat message (UTF-8 as content, or binary as contentBase64).',
        '',
        'When the library total is greater than 0, call search before answering questions about the user\'s life, goals, habits, work, health, relationships, or how to improve. Start with source=all and keywords from the question (example: "goals habits health work"). If that is thin, search each source that has a count above 0, or use an empty query for recent items. Use workspaces and shortTermMemory when relevant (e.g., recent context).',
        'Answer from the search hits (cite titles). Do not invent their notes or tasks. If search returns nothing useful, say so, then give general advice.',
    ];
    return lines.join('\n');
};
