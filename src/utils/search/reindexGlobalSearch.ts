import mongoose from 'mongoose';

import { IGlobalSearch } from '../../types/typesSchema/typesGlobalSearch/SchemaGlobalSearch.types';
import { ModelGlobalSearch } from '../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';

import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { ModelLifeEvents } from '../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';
import { ModelChatLlmThread } from '../../schema/schemaChatLlm/SchemaChatLlmThread.schema';

import { getMongodbObjectOrNull } from '../common/getMongodbObjectOrNull';


// Generate ngrams from text
export const generateNgrams = ({ text, minSize = 4, maxSize = 5 }: { text: string; minSize?: number; maxSize?: number }): string[] => {
    if (!text || text.length === 0) {
        return [];
    }

    const normalizedText = text.toLowerCase().replace(/\s+/g, ' ');
    const ngrams: string[] = [];

    for (let size = minSize; size <= maxSize; size++) {
        for (let i = 0; i <= normalizedText.length - size; i++) {
            const ngram = normalizedText.substring(i, i + size);
            if (ngram.trim().length > 0) {
                ngrams.push(ngram);
            }
        }
    }

    return [...new Set(ngrams)]; // Remove duplicates
};

const getDocuments = async ({ reindexDocumentArr, username }: {
    reindexDocumentArr: Array<{ entityType: string; documentId: string }>;
    username: string;
}): Promise<{
    taskArr: any[];
    notesArr: any[];
    lifeEventArr: any[];
    infoVaultArr: any[];
    chatLlmThreadArr: any[];
}> => {
    try {
        // Group document IDs by entity type
        const taskIds: mongoose.Types.ObjectId[] = [];
        const noteIds: mongoose.Types.ObjectId[] = [];
        const lifeEventIds: mongoose.Types.ObjectId[] = [];
        const infoVaultIds: mongoose.Types.ObjectId[] = [];
        const chatLlmThreadIds: mongoose.Types.ObjectId[] = [];

        for (const doc of reindexDocumentArr) {
            const entityIdObj = getMongodbObjectOrNull(doc.documentId);
            if (!entityIdObj) {
                continue;
            }

            if (doc.entityType === 'task') {
                taskIds.push(entityIdObj);
            } else if (doc.entityType === 'note') {
                noteIds.push(entityIdObj);
            } else if (doc.entityType === 'lifeEvent') {
                lifeEventIds.push(entityIdObj);
            } else if (doc.entityType === 'infoVault') {
                infoVaultIds.push(entityIdObj);
            } else if (doc.entityType === 'chatLlmThread') {
                chatLlmThreadIds.push(entityIdObj);
            }
        }

        let taskArr: any[] = [];
        let notesArr: any[] = [];
        let lifeEventArr: any[] = [];
        let infoVaultArr: any[] = [];
        let chatLlmThreadArr: any[] = [];

        // Process tasks - aggregate with comments lookup
        if (taskIds.length > 0) {
            taskArr = await ModelTask.aggregate([
                {
                    $match: {
                        _id: { $in: taskIds },
                        username: username,
                    }
                },
                {
                    $lookup: {
                        from: 'commentCommon',
                        let: { entityId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$entityId', '$$entityId'] },
                                            { $eq: ['$username', username] }
                                        ]
                                    }
                                }
                            }
                        ],
                        as: 'comments'
                    }
                }
            ]);
        }

        // Process notes - aggregate with comments lookup
        if (noteIds.length > 0) {
            notesArr = await ModelNotes.aggregate([
                {
                    $match: {
                        _id: { $in: noteIds },
                        username: username,
                    }
                },
                {
                    $lookup: {
                        from: 'commentCommon',
                        let: { entityId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$entityId', '$$entityId'] },
                                            { $eq: ['$username', username] }
                                        ]
                                    }
                                }
                            }
                        ],
                        as: 'comments'
                    }
                }
            ]);
        }

        // Process life events - aggregate with comments lookup
        if (lifeEventIds.length > 0) {
            lifeEventArr = await ModelLifeEvents.aggregate([
                {
                    $match: {
                        _id: { $in: lifeEventIds },
                        username: username,
                    }
                },
                {
                    $lookup: {
                        from: 'commentCommon',
                        let: { entityId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$entityId', '$$entityId'] },
                                            { $eq: ['$username', username] }
                                        ]
                                    }
                                }
                            }
                        ],
                        as: 'comments'
                    }
                }
            ]);
        }

        // Process info vault - aggregate with comments lookup
        if (infoVaultIds.length > 0) {
            infoVaultArr = await ModelInfoVault.aggregate([
                {
                    $match: {
                        _id: { $in: infoVaultIds },
                        username: username,
                    }
                },
                {
                    $lookup: {
                        from: 'commentCommon',
                        let: { entityId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$entityId', '$$entityId'] },
                                            { $eq: ['$username', username] }
                                        ]
                                    }
                                }
                            }
                        ],
                        as: 'comments'
                    }
                }
            ]);
        }

        // Process chat LLM threads - aggregate with comments lookup
        if (chatLlmThreadIds.length > 0) {
            chatLlmThreadArr = await ModelChatLlmThread.aggregate([
                {
                    $match: {
                        _id: { $in: chatLlmThreadIds },
                        username: username,
                    }
                },
                {
                    $lookup: {
                        from: 'commentCommon',
                        let: { entityId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$entityId', '$$entityId'] },
                                            { $eq: ['$username', username] }
                                        ]
                                    }
                                }
                            }
                        ],
                        as: 'comments'
                    }
                }
            ]);
        }

        return {
            taskArr,
            notesArr,
            lifeEventArr,
            infoVaultArr,
            chatLlmThreadArr,
        };
    } catch (error) {
        console.error('Error getting documents:', error);
        return {
            taskArr: [],
            notesArr: [],
            lifeEventArr: [],
            infoVaultArr: [],
            chatLlmThreadArr: [],
        };
    }
}

const getInsertObjectFromTask = (task: any): IGlobalSearch => {
    const textParts: string[] = [];
    if (task.title) textParts.push(task.title.toLowerCase());
    if (task.description) textParts.push(task.description.toLowerCase());
    if (task.priority) textParts.push(task.priority.toLowerCase());
    if (Array.isArray(task.labels)) {
        textParts.push(...task.labels.map((label: string) => label.toLowerCase()));
    }
    if (Array.isArray(task.labelsAi)) {
        textParts.push(...task.labelsAi.map((label: string) => label.toLowerCase()));
    }
    
    const searchableText = textParts.join(' ');
    const ngrams = textParts.flatMap(text => generateNgrams({ text }));
    
    return {
        entityId: task._id,
        entityType: 'task',
        username: task.username,
        text: searchableText,
        ngram: ngrams,
        collectionName: 'task',
        taskIsCompleted: task.isCompleted,
        taskIsArchived: task.isArchived,
        taskWorkspaceId: task.workspaceId,
        updatedAtUtc: task.updatedAtUtc || new Date(),
    } as IGlobalSearch;
};

const getInsertObjectFromNote = (note: any): IGlobalSearch => {
    const textParts: string[] = [];
    if (note.title) textParts.push(note.title.toLowerCase());
    if (note.content) textParts.push(note.content.toLowerCase());
    if (Array.isArray(note.tags)) {
        textParts.push(...note.tags.map((tag: string) => tag.toLowerCase()));
    }
    if (Array.isArray(note.tagsAi)) {
        textParts.push(...note.tagsAi.map((tag: string) => tag.toLowerCase()));
    }
    
    const searchableText = textParts.join(' ');
    const ngrams = textParts.flatMap(text => generateNgrams({ text }));
    
    return {
        entityId: note._id,
        entityType: 'note',
        username: note.username,
        text: searchableText,
        ngram: ngrams,
        collectionName: 'notes',
        notesWorkspaceId: note.workspaceId,
        updatedAtUtc: note.updatedAtUtc || new Date(),
    } as IGlobalSearch;
};

const getInsertObjectFromLifeEvent = (lifeEvent: any): IGlobalSearch => {
    const textParts: string[] = [];
    if (lifeEvent.title) textParts.push(lifeEvent.title.toLowerCase());
    if (lifeEvent.description) textParts.push(lifeEvent.description.toLowerCase());
    if (Array.isArray(lifeEvent.tags)) {
        textParts.push(...lifeEvent.tags.map((tag: string) => tag.toLowerCase()));
    }
    if (Array.isArray(lifeEvent.tagsAi)) {
        textParts.push(...lifeEvent.tagsAi.map((tag: string) => tag.toLowerCase()));
    }
    
    const searchableText = textParts.join(' ');
    const ngrams = textParts.flatMap(text => generateNgrams({ text }));
    
    return {
        entityId: lifeEvent._id,
        entityType: 'lifeEvent',
        username: lifeEvent.username,
        text: searchableText,
        ngram: ngrams,
        collectionName: 'lifeEvents',
        lifeEventIsDiary: lifeEvent.isDiary,
        updatedAtUtc: lifeEvent.updatedAtUtc || new Date(),
    } as IGlobalSearch;
};

const getInsertObjectFromInfoVault = (infoVault: any): IGlobalSearch => {
    const textParts: string[] = [];
    if (infoVault.title) textParts.push(infoVault.title.toLowerCase());
    if (infoVault.content) textParts.push(infoVault.content.toLowerCase());
    if (Array.isArray(infoVault.tags)) {
        textParts.push(...infoVault.tags.map((tag: string) => tag.toLowerCase()));
    }
    if (Array.isArray(infoVault.tagsAi)) {
        textParts.push(...infoVault.tagsAi.map((tag: string) => tag.toLowerCase()));
    }
    
    const searchableText = textParts.join(' ');
    const ngrams = textParts.flatMap(text => generateNgrams({ text }));
    
    return {
        entityId: infoVault._id,
        entityType: 'infoVault',
        username: infoVault.username,
        text: searchableText,
        ngram: ngrams,
        collectionName: 'infoVault',
        updatedAtUtc: infoVault.updatedAtUtc || new Date(),
    } as IGlobalSearch;
};

const getInsertObjectFromChatLlmThread = (chatLlmThread: any): IGlobalSearch => {
    const textParts: string[] = [];
    if (chatLlmThread.threadTitle) textParts.push(chatLlmThread.threadTitle.toLowerCase());
    if (Array.isArray(chatLlmThread.tagsAi)) {
        textParts.push(...chatLlmThread.tagsAi.map((tag: string) => tag.toLowerCase()));
    }
    if (chatLlmThread.aiSummary) textParts.push(chatLlmThread.aiSummary.toLowerCase());
    if (chatLlmThread.systemPrompt) textParts.push(chatLlmThread.systemPrompt.toLowerCase());
    
    const searchableText = textParts.join(' ');
    const ngrams = textParts.flatMap(text => generateNgrams({ text }));
    
    return {
        entityId: chatLlmThread._id,
        entityType: 'chatLlmThread',
        username: chatLlmThread.username,
        text: searchableText,
        ngram: ngrams,
        collectionName: 'chatLlmThread',
        updatedAtUtc: chatLlmThread.updatedAtUtc || new Date(),
    } as IGlobalSearch;
};




// Reindex documents
export const reindexDocument = async ({ 
    reindexDocumentArr, 
    username, 
}: { 
    reindexDocumentArr: Array<{ entityType: string; documentId: string }>; 
    username: string;
}): Promise<void> => {
    try {
        if (!reindexDocumentArr || reindexDocumentArr.length === 0) {
            return;
        }

        const insertRecords: IGlobalSearch[] = [];

        // delete old records
        const deleteIds: mongoose.Types.ObjectId[] = [];
        
        for (const doc of reindexDocumentArr) {
            const entityIdObj = getMongodbObjectOrNull(doc.documentId);
            if (!entityIdObj) {
                continue;
            }
            deleteIds.push(entityIdObj);
        }

        if (deleteIds.length > 0) {
            await ModelGlobalSearch.deleteMany({
                entityId: { $in: deleteIds },
                username: username,
            });
        }

        let documentsObj = await getDocuments({ reindexDocumentArr, username });
        let taskArr = documentsObj.taskArr;
        let notesArr = documentsObj.notesArr;
        let lifeEventArr = documentsObj.lifeEventArr;
        let infoVaultArr = documentsObj.infoVaultArr;
        let chatLlmThreadArr = documentsObj.chatLlmThreadArr;

        for (const task of taskArr) {
            const insertObject = getInsertObjectFromTask(task);
            insertRecords.push(insertObject);
        }
        for (const note of notesArr) {
            const insertObject = getInsertObjectFromNote(note);
            insertRecords.push(insertObject);
        }
        for (const lifeEvent of lifeEventArr) {
            const insertObject = getInsertObjectFromLifeEvent(lifeEvent);
            insertRecords.push(insertObject);
        }
        for (const infoVault of infoVaultArr) {
            const insertObject = getInsertObjectFromInfoVault(infoVault);
            insertRecords.push(insertObject);
        }
        for (const chatLlmThread of chatLlmThreadArr) {
            const insertObject = getInsertObjectFromChatLlmThread(chatLlmThread);
            insertRecords.push(insertObject);
        }

        // insert new records
        if (insertRecords.length > 0) {
            await ModelGlobalSearch.insertMany(insertRecords);
        }
        

    } catch (error) {
        console.error('Error reindexing documents:', error);
    }
};

// Reindex parent entities when comments change
export const reindexComments = async ({ entities, username }: { entities: Array<{ entityId: string; entityType: string }>; username: string }): Promise<void> => {
    try {
        const reindexDocumentArr = entities.map(({ entityId, entityType }) => ({
            entityType,
            documentId: entityId,
        }));
        await reindexDocument({ reindexDocumentArr, username });
    } catch (error) {
        console.error('Error reindexing comments:', error);
    }
};

// Reindex all documents for a user
export const reindexAll = async ({ username }: { username: string }): Promise<void> => {
    try {
        // delete old records
        await ModelGlobalSearch.deleteMany({ username: username });

        // Get all document IDs for each entity type using aggregation
        const [tasks, notes, lifeEvents, infoVaultSignificantDates, chatLlmThreads] = await Promise.all([
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
        ]);

        // Build reindex document array
        const reindexDocumentArr: Array<{ entityType: string; documentId: string }> = [];

        tasks.forEach(task => {
            reindexDocumentArr.push({ entityType: 'task', documentId: task._id.toString() });
        });

        notes.forEach(note => {
            reindexDocumentArr.push({ entityType: 'note', documentId: note._id.toString() });
        });

        lifeEvents.forEach(lifeEvent => {
            reindexDocumentArr.push({ entityType: 'lifeEvent', documentId: lifeEvent._id.toString() });
        });

        infoVaultSignificantDates.forEach(infoVault => {
            reindexDocumentArr.push({ entityType: 'infoVault', documentId: infoVault._id.toString() });
        });

        chatLlmThreads.forEach(thread => {
            reindexDocumentArr.push({ entityType: 'chatLlmThread', documentId: thread._id.toString() });
        });

        console.log(`Total documents to reindex: ${reindexDocumentArr.length}`);

        // Reindex all documents in batches
        const batchSize = 100;
        const totalBatches = Math.ceil(reindexDocumentArr.length / batchSize);
        for (let i = 0; i < reindexDocumentArr.length; i += batchSize) {
            const batchNumber = Math.floor(i / batchSize) + 1;
            console.log(`Reindexing batch ${batchNumber} of ${totalBatches}`);
            const batch = reindexDocumentArr.slice(i, i + batchSize);
            await reindexDocument({ reindexDocumentArr: batch, username });
        }
    } catch (error) {
        console.error('Error reindexing all documents:', error);
        throw error;
    }
};
