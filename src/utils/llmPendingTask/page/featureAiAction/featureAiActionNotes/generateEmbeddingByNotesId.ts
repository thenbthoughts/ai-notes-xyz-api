import { ObjectId } from 'mongodb';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { v5 as uuidv5 } from 'uuid';

import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { ModelNotes } from "../../../../../schema/schemaNotes/SchemaNotes.schema";
import { INotes } from "../../../../../types/typesSchema/typesSchemaNotes/SchemaNotes.types";

import { getQdrantClient } from '../../../../../config/qdrantConfig';
import { generateEmbedding, generateUuidNamespaceDefaultDomain } from '../../../../llm/ollamaCommonFunc';

/**
 * Find and validate notes record by ID
 */
const findNotesRecord = async (targetRecordId: string | null): Promise<INotes | null> => {
    if (!targetRecordId) {
        console.log('Target record ID is null');
        return null;
    }

    const notesRecords = await ModelNotes.find({
        _id: targetRecordId,
    }) as INotes[];

    if (!notesRecords || notesRecords.length !== 1) {
        console.log('notesRecords not found');
        return null;
    }

    return notesRecords[0];
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
 * Build content string from notes data
 */
const buildContentFromNotes = (notesRecord: INotes): string => {
    let content = `Title: ${notesRecord.title}\n`;
    
    if (notesRecord.description.length >= 1) {
        const markdownContent = NodeHtmlMarkdown.translate(notesRecord.description);
        content += `Description: ${markdownContent}\n`;
    }
    
    if (notesRecord.isStar) {
        content += `Is Star: Starred\n`;
    }
    
    if (notesRecord.tags.length >= 1) {
        content += `Tags: ${notesRecord.tags.join(', ')}\n`;
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
const createVectorPoint = (notesId: ObjectId, embedding: number[], content: string) => {
    const uuid = uuidv5(`notes-record-${notesId.toString()}`, generateUuidNamespaceDefaultDomain());
    console.log('uuid: ', uuid);

    return {
        id: uuid,
        vector: embedding,
        payload: {
            text: content,
            collectionName: 'notes',
            recordId: notesId.toString(),
            recordType: 'notes-record',
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
 * Main function to generate embedding by notes ID
 */
const generateEmbeddingByNotesId = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // Step 1: Find and validate notes record
        const notesRecord = await findNotesRecord(targetRecordId);
        if (!notesRecord) {
            // TODO delete notes from vector db
            return true;
        }

        const notesId = notesRecord._id as ObjectId;

        // Step 2: Check if AI features are enabled for this user
        const user = await ModelUser.findOne({
            username: notesRecord.username,
            featureAiActionsEnabled: true,
            featureAiActionsNotes: true
        });
        if (!user) {
            console.log('Notes AI or AI features not enabled for user:', notesRecord.username);
            return true; // Skip embedding generation if AI features or Notes AI is not enabled
        }

        // Step 4: Validate API keys
        const apiKeys = await validateApiKeys(notesRecord.username);
        if (!apiKeys) {
            return true;
        }

        // Step 6: Build content from notes
        const content = buildContentFromNotes(notesRecord);

        // Step 7: Generate embedding vector
        const embedding = await generateEmbeddingVector(content, apiKeys.apiKeyOllamaEndpoint);

        // Step 8: Create vector point
        const point = createVectorPoint(notesId, embedding, content);

        // Step 9: Setup Qdrant client
        const qdrantClient = await getQdrantClient({
            apiKeyQdrantEndpoint: apiKeys.apiKeyQdrantEndpoint,
            apiKeyQdrantPassword: apiKeys.apiKeyQdrantPassword,
        });

        if (!qdrantClient) {
            return false;
        }

        // collection name
        const collectionName = `index-user-${notesRecord.username}`;

        // Step 10: Ensure collection exists
        await ensureQdrantCollection(qdrantClient, collectionName, embedding.length);

        // Step 11: Upsert to vector database
        await upsertToVectorDb(qdrantClient, collectionName, [point]);

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default generateEmbeddingByNotesId;