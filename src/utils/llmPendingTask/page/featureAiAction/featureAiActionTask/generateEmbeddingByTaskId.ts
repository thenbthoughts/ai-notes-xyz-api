import { ObjectId } from 'mongodb';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { v5 as uuidv5 } from 'uuid';

import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelTask } from "../../../../../schema/schemaTask/SchemaTask.schema";
import { tsTaskList } from "../../../../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types";

import { getQdrantClient } from '../../../../../config/qdrantConfig';
import { generateEmbedding, generateUuidNamespaceDefaultDomain } from '../../../../llm/ollamaCommonFunc';
import mongoose from 'mongoose';

/**
 * Find and validate task record by ID
 */
const findTaskRecord = async (targetRecordId: string | null): Promise<tsTaskList | null> => {
    if (!targetRecordId) {
        console.log('Target record ID is null');
        return null;
    }

    const taskRecords = await ModelTask.find({
        _id: targetRecordId,
    }) as tsTaskList[];

    if (!taskRecords || taskRecords.length !== 1) {
        console.log('taskRecords not found');
        return null;
    }

    return taskRecords[0];
};

/**
 * Validate user API keys for Ollama and Qdrant
 */
const validateApiKeys = async (username: string) => {
    const apiKeys = await ModelUserApiKey.findOne({
        username: username,
        apiKeyOllamaValid: true,
        apiKeyQdrantValid: true,
    });

    return apiKeys;
};

/**
 * Build content string from task data
 */
const buildContentFromTask = async ({
    username,
    taskId,
}: {
    username: string,
    taskId: mongoose.Types.ObjectId,
}) => {
    let taskStr = '';

    const currentDate = new Date();
    const currentDateFromLast3Days = currentDate.getTime() - 24 * 60 * 60 * 1000 * 3;
    const currentDateFromLast3DaysDate = new Date(currentDateFromLast3Days);

    const currentDateFromLast15Days = currentDate.getTime() - 24 * 60 * 60 * 1000 * 15;
    const currentDateFromLast15DaysDate = new Date(currentDateFromLast15Days);

    const resultTasks = await ModelTask.aggregate([
        {
            $match: {
                _id: taskId,
                username: username,
            }
        },
        {
            $lookup: {
                from: 'taskWorkspace',
                localField: 'taskWorkspaceId',
                foreignField: '_id',
                as: 'taskWorkspace',
            }
        },
        {
            $lookup: {
                from: 'taskStatusList',
                localField: 'taskStatusId',
                foreignField: '_id',
                as: 'taskStatusList',
            }
        },
        {
            $lookup: {
                from: 'commentsCommon',
                localField: '_id',
                foreignField: 'entityId',
                as: 'taskComments',
            }
        },
        {
            $lookup: {
                from: 'tasksSub',
                localField: '_id',
                foreignField: 'parentTaskId',
                as: 'tasksSub',
            }
        },
        {
            $addFields: {
                updatedAtUtcLast3DaysSortPoint: {
                    $cond: {
                        if: { $gte: ['$updatedAtUtc', currentDateFromLast3DaysDate] },
                        then: 50,
                        else: 5,
                    }
                },
                updatedAtUtcLast15DaysSortPoint: {
                    $cond: {
                        if: { $gte: ['$updatedAtUtc', currentDateFromLast15DaysDate] },
                        then: 25,
                        else: 5,
                    }
                },
                isCompletedSortPoint: {
                    $cond: {
                        if: { $eq: ['$isCompleted', true] },
                        then: -1000,
                        else: 5,
                    }
                },
                isArchivedSortPoint: {
                    $cond: {
                        if: { $eq: ['$isArchived', true] },
                        then: -1000,
                        else: 0,
                    }
                },
            }
        },
        {
            $addFields: {
                sortPoint: {
                    $add: [
                        '$updatedAtUtcLast3DaysSortPoint',
                        '$updatedAtUtcLast15DaysSortPoint',
                        '$isCompletedSortPoint',
                        '$isArchivedSortPoint',
                    ]
                }
            }
        },
        {
            $sort: {
                sortPoint: -1,
            }
        }
    ]);

    if (resultTasks.length >= 1) {
        for (let index = 0; index < resultTasks.length; index++) {
            const element = resultTasks[index];

            let taskId = element._id.toString();

            taskStr += `Task ${taskId} -> id -> ${taskId}.\n`;
            taskStr += `Task ${taskId} -> title -> ${element.title}.\n`;
            taskStr += `Task ${taskId} -> description -> ${element.description}.\n`;
            taskStr += `Task ${taskId} -> priority -> ${element.priority}.\n`;
            taskStr += `Task ${taskId} -> dueDate -> ${element.dueDate}.\n`;
            taskStr += `Task ${taskId} -> isCompleted -> ${element.isCompleted ? 'Yes' : 'No'}.\n`;
            taskStr += `Task ${taskId} -> isArchived -> ${element.isArchived ? 'Yes' : 'No'}.\n`;
            taskStr += `Task ${taskId} -> labels -> ${element.labels.join(', ')}.\n`;

            if (element.taskWorkspace.length >= 1) {
                taskStr += `Task ${taskId} -> workspace -> ${element.taskWorkspace[0].title}.\n`;
            }
            if (element.taskStatusList.length >= 1) {
                taskStr += `Task ${taskId} -> status -> ${element.taskStatusList[0].statusTitle}.\n`;
            }

            if (element.taskComments.length >= 1) {
                taskStr += `Task ${taskId} -> comments: \n`;
                for (let commentIndex = 0; commentIndex < element.taskComments.length; commentIndex++) {
                    const comment = element.taskComments[commentIndex];
                    taskStr += `Task ${taskId} -> comments ${commentIndex + 1} -> ${comment.commentText} ${comment.isAi ? ' (AI)' : ''} \n`;
                }
            }

            if (element.tasksSub.length >= 1) {
                taskStr += `Task ${taskId} -> subtasks: \n`;
                for (let subIndex = 0; subIndex < element.tasksSub.length; subIndex++) {
                    const subtask = element.tasksSub[subIndex];
                    taskStr += `Task ${taskId} -> subtasks ${subIndex + 1} -> ${subtask.title} (${subtask.taskCompletedStatus ? 'completed' : 'pending'}) \n`;
                }
            }

            taskStr += '\n';
        }
        taskStr += '\n\n';
    }

    return taskStr;
};

/**
 * Generate embedding vector from content
 */
const generateEmbeddingVector = async (content: string, apiKeyOllamaEndpoint: string) => {
    const result = await generateEmbedding({
        apiKeyOllamaEndpoint: apiKeyOllamaEndpoint,
        text: content,
    });

    console.log('resultGenerateEmbedding: ', result);

    if (result.error !== '') {
        throw new Error(`Failed to generate embedding: ${result.error}`);
    }

    return result.data.embedding;
};

/**
 * Create vector point with UUID
 */
const createVectorPoint = (taskId: ObjectId, embedding: number[], content: string) => {
    const uuid = uuidv5(`task-record-${taskId.toString()}`, generateUuidNamespaceDefaultDomain());
    console.log('uuid: ', uuid);

    return {
        id: uuid,
        vector: embedding,
        payload: {
            text: content,
            collectionName: 'task',
            recordId: taskId.toString(),
            recordType: 'task-record',
        }
    };
};

/**
 * Ensure Qdrant collection exists
 */
const ensureQdrantCollection = async (qdrantClient: any, collectionName: string, embeddingSize: number) => {
    try {
        await qdrantClient.createCollection(collectionName, {
            vectors: {
                size: embeddingSize,
                distance: 'Cosine' // Cosine similarity works well with text embeddings
            }
        });
    } catch (error) {
        console.log('error create collection: ', error);
    }
};

/**
 * Upsert points to vector database
 */
const upsertToVectorDb = async (qdrantClient: any, collectionName: string, points: any[]) => {
    const result = await qdrantClient.upsert(collectionName, {
        wait: true,
        points: points,
    });

    console.log('result: ', result);
    return result;
};

/**
 * Main function to generate embedding by task ID
 */
const generateEmbeddingByTaskId = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // Step 1: Find and validate task record
        const taskRecord = await findTaskRecord(targetRecordId);
        if (!taskRecord) {
            // TODO delete task from vector db
            return true;
        }

        const taskId = taskRecord._id as ObjectId;

        // Step 2: Validate API keys
        const apiKeys = await validateApiKeys(taskRecord.username);
        if (!apiKeys) {
            return true;
        }

        // Step 3: Build content from task
        const content = await buildContentFromTask({
            username: taskRecord.username,
            taskId: taskRecord._id as mongoose.Types.ObjectId,
        });

        // Step 4: Generate embedding vector
        const embedding = await generateEmbeddingVector(content, apiKeys.apiKeyOllamaEndpoint);

        // Step 5: Create vector point
        const point = createVectorPoint(taskId, embedding, content);

        // Step 6: Setup Qdrant client
        const qdrantClient = await getQdrantClient({
            apiKeyQdrantEndpoint: apiKeys.apiKeyQdrantEndpoint,
            apiKeyQdrantPassword: apiKeys.apiKeyQdrantPassword,
        });

        if (!qdrantClient) {
            return false;
        }

        // collection name
        const collectionName = `index-user-${taskRecord.username}`;

        // Step 7: Ensure collection exists
        await ensureQdrantCollection(qdrantClient, collectionName, embedding.length);

        // Step 8: Upsert to vector database
        await upsertToVectorDb(qdrantClient, collectionName, [point]);

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default generateEmbeddingByTaskId;

