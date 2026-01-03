import { ObjectId } from 'mongodb';
import { v5 as uuidv5 } from 'uuid';

import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { IChatLlmThread } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";

import { getQdrantClient } from '../../../../../config/qdrantConfig';
import { generateEmbedding, generateUuidNamespaceDefaultDomain } from '../../../../llm/ollamaCommonFunc';

/**
 * Find and validate chat thread record by ID
 */
const findChatThreadRecord = async (targetRecordId: string | null): Promise<IChatLlmThread | null> => {
    if (!targetRecordId) {
        console.log('Target record ID is null');
        return null;
    }

    const chatThreadRecords = await ModelChatLlmThread.find({
        _id: targetRecordId,
    }) as IChatLlmThread[];

    if (!chatThreadRecords || chatThreadRecords.length !== 1) {
        console.log('chatThreadRecords not found');
        return null;
    }

    return chatThreadRecords[0];
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
 * Build content string from chat thread data
 */
const buildContentFromChatThread = async (chatThreadId: ObjectId): Promise<string> => {
    const messages = await ModelChatLlm.find({
        threadId: chatThreadId,
    }) as IChatLlm[];

    let content = '';
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.isAi) {
            content += `AI: ${message.content}\n`;
        } else {
            content += `User: ${message.content.replace('Text to audio:', '')}\n`;
        }
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
const createVectorPoint = (chatThreadId: ObjectId, embedding: number[], content: string) => {
    const uuid = uuidv5(`chatThread-record-${chatThreadId.toString()}`, generateUuidNamespaceDefaultDomain());
    console.log('uuid: ', uuid);

    return {
        id: uuid,
        vector: embedding,
        payload: {
            text: content,
            collectionName: 'chatThread',
            recordId: chatThreadId.toString(),
            recordType: 'chatThread-record',
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
 * Main function to generate embedding by chat thread ID
 */
const generateEmbeddingByChatThreadId = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // Step 1: Find and validate chat thread record
        const chatThreadRecord = await findChatThreadRecord(targetRecordId);
        if (!chatThreadRecord) {
            // TODO delete chat thread from vector db
            return true;
        }

        const chatThreadId = chatThreadRecord._id as ObjectId;

        // Step 2: Validate API keys
        const apiKeys = await validateApiKeys(chatThreadRecord.username);
        if (!apiKeys) {
            return true;
        }

        // Step 3: Build content from chat thread
        const content = await buildContentFromChatThread(chatThreadId);

        // Step 4: Generate embedding vector
        const embedding = await generateEmbeddingVector(content, apiKeys.apiKeyOllamaEndpoint);

        // Step 5: Create vector point
        const point = createVectorPoint(chatThreadId, embedding, content);

        // Step 6: Setup Qdrant client
        const qdrantClient = await getQdrantClient({
            apiKeyQdrantEndpoint: apiKeys.apiKeyQdrantEndpoint,
            apiKeyQdrantPassword: apiKeys.apiKeyQdrantPassword,
        });

        if (!qdrantClient) {
            return false;
        }

        // collection name
        const collectionName = `index-user-${chatThreadRecord.username}`;

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

export default generateEmbeddingByChatThreadId;

