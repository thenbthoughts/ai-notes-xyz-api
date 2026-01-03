import { ObjectId } from 'mongodb';
import { v5 as uuidv5 } from 'uuid';

import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelLifeEvents } from "../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ILifeEvents } from "../../../../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types";

import { getQdrantClient } from '../../../../../config/qdrantConfig';
import { generateEmbedding, generateUuidNamespaceDefaultDomain } from '../../../../llm/ollamaCommonFunc';

/**
 * Find and validate life events record by ID
 */
const findLifeEventsRecord = async (targetRecordId: string | null): Promise<ILifeEvents | null> => {
    if (!targetRecordId) {
        console.log('Target record ID is null');
        return null;
    }

    const lifeEventsRecords = await ModelLifeEvents.find({
        _id: targetRecordId,
    }) as ILifeEvents[];

    if (!lifeEventsRecords || lifeEventsRecords.length !== 1) {
        console.log('lifeEventsRecords not found');
        return null;
    }

    return lifeEventsRecords[0];
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
 * Build content string from life events data
 */
const buildContentFromLifeEvents = (lifeEventsRecord: ILifeEvents): string => {
    let content = `Title: ${lifeEventsRecord.title}\n`;
    content += `Description: ${lifeEventsRecord.description}\n`;
    content += `Event Impact: ${lifeEventsRecord.eventImpact}\n`;
    
    if (lifeEventsRecord.isStar) {
        content += `Is Star: Starred\n`;
    }
    
    if (lifeEventsRecord.tags.length >= 1) {
        content += `Tags: ${lifeEventsRecord.tags.join(', ')}\n`;
    }
    
    content += `Event Date: ${lifeEventsRecord.eventDateUtc}\n`;
    content += `Event Date Year: ${lifeEventsRecord.eventDateYearStr}\n`;
    content += `Event Date Year Month: ${lifeEventsRecord.eventDateYearMonthStr}\n`;

    if (lifeEventsRecord.aiCategory) {
        content += `Category: ${lifeEventsRecord.aiCategory}\n`;
    }
    if (lifeEventsRecord.aiSubCategory) {
        content += `Sub Category: ${lifeEventsRecord.aiSubCategory}\n`;
    }

    return content;
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
const createVectorPoint = (lifeEventsId: ObjectId, embedding: number[], content: string) => {
    const uuid = uuidv5(`lifeEvents-record-${lifeEventsId.toString()}`, generateUuidNamespaceDefaultDomain());
    console.log('uuid: ', uuid);

    return {
        id: uuid,
        vector: embedding,
        payload: {
            text: content,
            collectionName: 'lifeEvents',
            recordId: lifeEventsId.toString(),
            recordType: 'lifeEvents-record',
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
 * Main function to generate embedding by life events ID
 */
const generateEmbeddingByLifeEventsId = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // Step 1: Find and validate life events record
        const lifeEventsRecord = await findLifeEventsRecord(targetRecordId);
        if (!lifeEventsRecord) {
            // TODO delete life events from vector db
            return true;
        }

        const lifeEventsId = lifeEventsRecord._id as ObjectId;

        // Step 2: Validate API keys
        const apiKeys = await validateApiKeys(lifeEventsRecord.username);
        if (!apiKeys) {
            return true;
        }

        // Step 3: Build content from life events
        const content = buildContentFromLifeEvents(lifeEventsRecord);

        // Step 4: Generate embedding vector
        const embedding = await generateEmbeddingVector(content, apiKeys.apiKeyOllamaEndpoint);

        // Step 5: Create vector point
        const point = createVectorPoint(lifeEventsId, embedding, content);

        // Step 6: Setup Qdrant client
        const qdrantClient = await getQdrantClient({
            apiKeyQdrantEndpoint: apiKeys.apiKeyQdrantEndpoint,
            apiKeyQdrantPassword: apiKeys.apiKeyQdrantPassword,
        });

        if (!qdrantClient) {
            return false;
        }

        // collection name
        const collectionName = `index-user-${lifeEventsRecord.username}`;

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

export default generateEmbeddingByLifeEventsId;

