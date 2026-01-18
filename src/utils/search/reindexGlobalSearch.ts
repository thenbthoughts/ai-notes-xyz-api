import { ModelGlobalSearch } from '../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';

import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { ModelLifeEvents } from '../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';
import { ModelChatLlmThread } from '../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelChatLlm } from '../../schema/schemaChatLlm/SchemaChatLlm.schema';

import { getMongodbObjectOrNull } from '../common/getMongodbObjectOrNull';

import { funcSearchReindexNotesById } from './searchReindexNotes';
import { funcSearchReindexTasksById } from './searchReindexTasks';
import { funcSearchReindexLifeEventsById } from './searchReindexLifeEvents';
import { funcSearchReindexInfoVaultById } from './searchReindexInfoVault';
import { funcSearchReindexChatLlmThreadById } from './searchReindexChatLlmThread';
import { funcSearchReindexChatLlmById } from './searchReindexChatLlm';

// Reindex all documents for a user
export const reindexAll = async ({ username }: { username: string }): Promise<void> => {
    try {
        // delete old records
        await ModelGlobalSearch.deleteMany({ username: username });

        // Get all document IDs for each entity type using aggregation
        const [tasks, notes, lifeEvents, infoVault, chatLlmThreads, chatLlmMessages] = await Promise.all([
            ModelTask.aggregate([
                { $match: { username } },
                { $project: { _id: 1 } }
            ]),
            ModelNotes.aggregate([
                { $match: { username } },
                { $project: { _id: 1 } }
            ]),
            ModelLifeEvents.aggregate([
                { $match: { username } },
                { $project: { _id: 1 } }
            ]),
            ModelInfoVault.aggregate([
                { $match: { username } },
                { $project: { _id: 1 } }
            ]),
            ModelChatLlmThread.aggregate([
                { $match: { username } },
                { $project: { _id: 1 } }
            ]),
            ModelChatLlm.aggregate([
                { $match: { username } },
                { $project: { _id: 1 } }
            ]),
        ]);

        // Build reindex document array
        const reindexDocumentArr: Array<{
            collectionName: 'tasks' | 'notes' | 'lifeEvents' | 'infoVault' | 'chatLlmThread' | 'chatLlm';
            documentId: string;
        }> = [];

        tasks.forEach(task => {
            reindexDocumentArr.push({ collectionName: 'tasks', documentId: task._id.toString() });
        });

        notes.forEach(note => {
            reindexDocumentArr.push({ collectionName: 'notes', documentId: note._id.toString() });
        });

        lifeEvents.forEach(lifeEvent => {
            reindexDocumentArr.push({ collectionName: 'lifeEvents', documentId: lifeEvent._id.toString() });
        });

        infoVault.forEach(infoVault => {
            reindexDocumentArr.push({ collectionName: 'infoVault', documentId: infoVault._id.toString() });
        });

        chatLlmThreads.forEach(thread => {
            reindexDocumentArr.push({ collectionName: 'chatLlmThread', documentId: thread._id.toString() });
        });

        chatLlmMessages.forEach(message => {
            reindexDocumentArr.push({ collectionName: 'chatLlm', documentId: message._id.toString() });
        });

        console.log('Info vault length: ', infoVault.length);

        console.log(`Total documents to reindex: ${reindexDocumentArr.length}`);

        // Reindex all documents in batches
        const batchSize = 10;
        const totalBatches = Math.ceil(reindexDocumentArr.length / batchSize);
        for (let i = 0; i < reindexDocumentArr.length; i += batchSize) {
            const batchNumber = Math.floor(i / batchSize) + 1;
            console.log(`Reindexing batch ${batchNumber} of ${totalBatches}`);
            const batch = reindexDocumentArr.slice(i, i + batchSize);
            await reindexDocument({ reindexDocumentArr: batch });
        }
    } catch (error) {
        console.error('Error reindexing all documents:', error);
        throw error;
    }
};

export const reindexDocument = async ({
    reindexDocumentArr,
}: {
    reindexDocumentArr: Array<{
        collectionName: 'tasks' | 'notes' | 'lifeEvents' | 'infoVault' | 'chatLlmThread' | 'chatLlm';
        documentId: string;
    }>;
}): Promise<void> => {
    try {
        if (!reindexDocumentArr || reindexDocumentArr.length === 0) {
            return;
        }

        for (const doc of reindexDocumentArr) {
            const entityIdObj = getMongodbObjectOrNull(doc.documentId);
            if (!entityIdObj) {
                continue;
            }

            if (doc.collectionName === 'tasks') {
                await funcSearchReindexTasksById({ recordId: entityIdObj.toString() });
            } else if (doc.collectionName === 'notes') {
                await funcSearchReindexNotesById({ recordId: entityIdObj.toString() });
            } else if (doc.collectionName === 'lifeEvents') {
                await funcSearchReindexLifeEventsById({ recordId: entityIdObj.toString() });
            } else if (doc.collectionName === 'infoVault') {
                await funcSearchReindexInfoVaultById({ recordId: entityIdObj.toString() });
            } else if (doc.collectionName === 'chatLlmThread') {
                await funcSearchReindexChatLlmThreadById({ recordId: entityIdObj.toString() });
            } else if (doc.collectionName === 'chatLlm') {
                await funcSearchReindexChatLlmById({ recordId: entityIdObj.toString() });
            }
        }
    } catch (error) {
        console.error('Error reindexing documents:', error);
    }
}

export const reindexComments = async ({
    entities,
}: {
    entities: Array<{ entityId: string; collectionName: 'notes' | 'task' | 'lifeEvent' | 'infoVault' | 'chatLlmThread' | 'chatLlm' }>;
}): Promise<void> => {
    try {
        if (!entities || entities.length === 0) {
            return;
        }

        for (const entity of entities) {
            if (entity.collectionName === 'notes') {
                await funcSearchReindexNotesById({ recordId: entity.entityId });
            } else if (entity.collectionName === 'task') {
                await funcSearchReindexTasksById({ recordId: entity.entityId });
            } else if (entity.collectionName === 'lifeEvent') {
                await funcSearchReindexLifeEventsById({ recordId: entity.entityId });
            } else if (entity.collectionName === 'infoVault') {
                await funcSearchReindexInfoVaultById({ recordId: entity.entityId });
            } else if (entity.collectionName === 'chatLlmThread') {
                await funcSearchReindexChatLlmThreadById({ recordId: entity.entityId });
            } else if (entity.collectionName === 'chatLlm') {
                await funcSearchReindexChatLlmById({ recordId: entity.entityId });
            }
        }
    } catch (error) {
        console.error('Error reindexing comments:', error);
    }
}