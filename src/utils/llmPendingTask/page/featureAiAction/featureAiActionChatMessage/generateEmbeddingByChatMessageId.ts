import { ObjectId } from 'mongodb';
import { v5 as uuidv5 } from 'uuid';

import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";

import { getQdrantClient } from '../../../../../config/qdrantConfig';
import { generateEmbedding, generateUuidNamespaceDefaultDomain } from '../../../../llm/ollamaCommonFunc';

/**
 * Find and validate chat message record by ID
 */
const findChatMessageRecord = async (targetRecordId: string | null): Promise<IChatLlm | null> => {
    if (!targetRecordId) {
        console.log('Target record ID is null');
        return null;
    }

    const chatMessageRecords = await ModelChatLlm.find({
        _id: targetRecordId,
    }) as IChatLlm[];

    if (!chatMessageRecords || chatMessageRecords.length !== 1) {
        console.log('chatMessageRecords not found');
        return null;
    }

    return chatMessageRecords[0];
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
 * Build content string from chat message data
 */
const buildContentFromChatMessage = (chatMessageRecord: IChatLlm): string => {
    let content = chatMessageRecord.content.replace('Text to audio:', '');
    
    if (chatMessageRecord.fileContentText && chatMessageRecord.fileContentText.length >= 1) {
        content += `\nFile Content: ${chatMessageRecord.fileContentText}`;
    }
    if (chatMessageRecord.fileContentAi && chatMessageRecord.fileContentAi.length >= 1) {
        content += `\nFile Content AI: ${chatMessageRecord.fileContentAi}`;
    }
    if (chatMessageRecord.tags.length >= 1) {
        content += `\nTags: ${chatMessageRecord.tags.join(', ')}`;
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
const createVectorPoint = (chatMessageId: ObjectId, embedding: number[], content: string) => {
    const uuid = uuidv5(`chatMessage-record-${chatMessageId.toString()}`, generateUuidNamespaceDefaultDomain());
    console.log('uuid: ', uuid);

    return {
        id: uuid,
        vector: embedding,
        payload: {
            text: content,
            collectionName: 'chatMessage',
            recordId: chatMessageId.toString(),
            recordType: 'chatMessage-record',
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
 * Main function to generate embedding by chat message ID
 */
const generateEmbeddingByChatMessageId = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // Step 1: Find and validate chat message record
        const chatMessageRecord = await findChatMessageRecord(targetRecordId);
        if (!chatMessageRecord) {
            // TODO delete chat message from vector db
            return true;
        }

        const chatMessageId = chatMessageRecord._id as ObjectId;

        // Step 2: Validate API keys
        const apiKeys = await validateApiKeys(chatMessageRecord.username);
        if (!apiKeys) {
            return true;
        }

        // Step 3: Build content from chat message
        const content = buildContentFromChatMessage(chatMessageRecord);

        // Step 4: Generate embedding vector
        const embedding = await generateEmbeddingVector(content, apiKeys.apiKeyOllamaEndpoint);

        // Step 5: Create vector point
        const point = createVectorPoint(chatMessageId, embedding, content);

        // Step 6: Setup Qdrant client
        const qdrantClient = await getQdrantClient({
            apiKeyQdrantEndpoint: apiKeys.apiKeyQdrantEndpoint,
            apiKeyQdrantPassword: apiKeys.apiKeyQdrantPassword,
        });

        if (!qdrantClient) {
            return false;
        }

        // collection name
        const collectionName = `index-user-${chatMessageRecord.username}`;

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

export default generateEmbeddingByChatMessageId;

