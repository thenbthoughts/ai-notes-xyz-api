import { ObjectId } from 'mongodb';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { v5 as uuidv5 } from 'uuid';

import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelInfoVault } from "../../../../../schema/schemaInfoVault/SchemaInfoVault.schema";
import { IInfoVaultContact } from "../../../../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVault.types";

import { getQdrantClient } from '../../../../../config/qdrantConfig';
import { generateEmbedding, generateUuidNamespaceDefaultDomain } from '../../../../llm/ollamaCommonFunc';

/**
 * Find and validate info vault record by ID
 */
const findInfoVaultRecord = async (targetRecordId: string | null): Promise<IInfoVaultContact | null> => {
    if (!targetRecordId) {
        console.log('Target record ID is null');
        return null;
    }

    const infoVaultRecords = await ModelInfoVault.find({
        _id: targetRecordId,
    }) as IInfoVaultContact[];

    if (!infoVaultRecords || infoVaultRecords.length !== 1) {
        console.log('infoVaultRecords not found');
        return null;
    }

    return infoVaultRecords[0];
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
 * Build content string from info vault data
 */
const buildContentFromInfoVault = (infoVaultRecord: IInfoVaultContact): string => {
    let content = `Name: ${infoVaultRecord.name}\n`;
    
    if (infoVaultRecord.nickname) {
        content += `Nickname: ${infoVaultRecord.nickname}\n`;
    }
    if (infoVaultRecord.company) {
        content += `Company: ${infoVaultRecord.company}\n`;
    }
    if (infoVaultRecord.jobTitle) {
        content += `Job Title: ${infoVaultRecord.jobTitle}\n`;
    }
    if (infoVaultRecord.department) {
        content += `Department: ${infoVaultRecord.department}\n`;
    }
    if (infoVaultRecord.notes && infoVaultRecord.notes.length >= 1) {
        const markdownContent = NodeHtmlMarkdown.translate(infoVaultRecord.notes);
        content += `Notes: ${markdownContent}\n`;
    }
    if (infoVaultRecord.tags.length >= 1) {
        content += `Tags: ${infoVaultRecord.tags.join(', ')}\n`;
    }
    if (infoVaultRecord.infoVaultType) {
        content += `Type: ${infoVaultRecord.infoVaultType}\n`;
    }
    if (infoVaultRecord.infoVaultSubType) {
        content += `Sub Type: ${infoVaultRecord.infoVaultSubType}\n`;
    }
    if (infoVaultRecord.relationshipType) {
        content += `Relationship Type: ${infoVaultRecord.relationshipType}\n`;
    }
    if (infoVaultRecord.contactFrequency) {
        content += `Contact Frequency: ${infoVaultRecord.contactFrequency}\n`;
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
const createVectorPoint = (infoVaultId: ObjectId, embedding: number[], content: string) => {
    const uuid = uuidv5(`infoVault-record-${infoVaultId.toString()}`, generateUuidNamespaceDefaultDomain());
    console.log('uuid: ', uuid);

    return {
        id: uuid,
        vector: embedding,
        payload: {
            text: content,
            collectionName: 'infoVault',
            recordId: infoVaultId.toString(),
            recordType: 'infoVault-record',
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
 * Main function to generate embedding by info vault ID
 */
const generateEmbeddingByInfoVaultId = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // Step 1: Find and validate info vault record
        const infoVaultRecord = await findInfoVaultRecord(targetRecordId);
        if (!infoVaultRecord) {
            // TODO delete info vault from vector db
            return true;
        }

        const infoVaultId = infoVaultRecord._id as ObjectId;

        // Step 2: Validate API keys
        const apiKeys = await validateApiKeys(infoVaultRecord.username);
        if (!apiKeys) {
            return true;
        }

        // Step 3: Build content from info vault
        const content = buildContentFromInfoVault(infoVaultRecord);

        // Step 4: Generate embedding vector
        const embedding = await generateEmbeddingVector(content, apiKeys.apiKeyOllamaEndpoint);

        // Step 5: Create vector point
        const point = createVectorPoint(infoVaultId, embedding, content);

        // Step 6: Setup Qdrant client
        const qdrantClient = await getQdrantClient({
            apiKeyQdrantEndpoint: apiKeys.apiKeyQdrantEndpoint,
            apiKeyQdrantPassword: apiKeys.apiKeyQdrantPassword,
        });

        if (!qdrantClient) {
            return false;
        }

        // collection name
        const collectionName = `index-user-${infoVaultRecord.username}`;

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

export default generateEmbeddingByInfoVaultId;

