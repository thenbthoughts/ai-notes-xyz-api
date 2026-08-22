import mongoose from 'mongoose';

import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { ModelMemoNote } from '../../schema/schemaMemo/SchemaMemoNote.schema';
import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';
import { ModelLifeEvents } from '../../schema/schemaLifeEvents/SchemaLifeEvents.schema';

export type UserLibraryCounts = {
    notes: number;
    tasks: number;
    memos: number;
    infoVault: number;
    lifeEvents: number;
    total: number;
};

export const getUserLibraryCounts = async (
    userId: mongoose.Types.ObjectId | string
): Promise<UserLibraryCounts> => {
    const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const [notes, tasks, memos, infoVault, lifeEvents] = await Promise.all([
        ModelNotes.countDocuments({ userId: uid }),
        ModelTask.countDocuments({ userId: uid }),
        ModelMemoNote.countDocuments({
            userId: uid,
            trashed: { $ne: true },
            archived: { $ne: true },
        }),
        ModelInfoVault.countDocuments({ userId: uid, isArchived: { $ne: true } }),
        ModelLifeEvents.countDocuments({ userId: uid }),
    ]);
    return {
        notes,
        tasks,
        memos,
        infoVault,
        lifeEvents,
        total: notes + tasks + memos + infoVault + lifeEvents,
    };
};

export const formatUserLibraryCountsLine = (counts: UserLibraryCounts): string =>
    `${counts.notes} notes, ${counts.tasks} tasks, ${counts.memos} memos, ${counts.infoVault} info vault records, ${counts.lifeEvents} life events`;

export const buildUserLibraryMcpContext = (counts: UserLibraryCounts): string => {
    const lines = [
        '## User library',
        `This signed-in user currently has ${counts.total} private records:`,
        `- notes: ${counts.notes}`,
        `- tasks: ${counts.tasks}`,
        `- memos: ${counts.memos}`,
        `- info vault: ${counts.infoVault}`,
        `- life events: ${counts.lifeEvents}`,
        '',
        'MCP tools (already configured in opencode.json):',
        '- search — args: query (keywords), source (all | notes | tasks | lifeEvents | memo | infoVault). Empty query returns recent items.',
        '- add_chat_file — attach a file to this chat message (UTF-8 as content, or binary as contentBase64).',
        '',
        'When the library total is greater than 0, call search before answering questions about the user\'s life, goals, habits, work, health, relationships, or how to improve. Start with source=all and keywords from the question (example: "goals habits health work"). If that is thin, search each source that has a count above 0, or use an empty query for recent items.',
        'Answer from the search hits (cite titles). Do not invent their notes or tasks. If search returns nothing useful, say so, then give general advice.',
    ];
    return lines.join('\n');
};
