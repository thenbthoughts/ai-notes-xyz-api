import { ObjectId } from 'mongodb';
import { v5 as uuidv5 } from 'uuid';

import { ModelUserApiKey } from "../../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelFaq } from "../../../../../../schema/schemaFaq/SchemaFaq.schema";
import { IFaq } from "../../../../../../types/typesSchema/typesFaq/SchemaFaq.types";

import { getQdrantClient } from "../../../../../../config/qdrantConfig";
import { generateEmbedding, generateUuidNamespaceDefaultDomain } from '../../../../../llm/ollamaCommonFunc';

/**
 * Find and validate FAQ record by ID
 */
const findFaqRecord = async (targetRecordId: string | null): Promise<IFaq | null> => {
    if (!targetRecordId) {
        console.log('Target record ID is null');
        return null;
    }

    const faqRecords = await ModelFaq.find({
        _id: targetRecordId,
    }) as IFaq[];

    if (!faqRecords || faqRecords.length !== 1) {
        console.log('FAQ record not found');
        return null;
    }

    return faqRecords[0];
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
 * Build content string from FAQ data
 */
const buildContentFromFaq = (faqRecord: IFaq): string => {
    let content = `Question: ${faqRecord.question}\n`;
    content += `Answer: ${faqRecord.answer}\n`;
    
    if (faqRecord.aiCategory && faqRecord.aiCategory.length >= 1) {
        content += `Category: ${faqRecord.aiCategory}\n`;
    }
    
    if (faqRecord.aiSubCategory && faqRecord.aiSubCategory.length >= 1) {
        content += `Sub Category: ${faqRecord.aiSubCategory}\n`;
    }
    
    if (faqRecord.tags && faqRecord.tags.length >= 1) {
        content += `Tags: ${faqRecord.tags.join(', ')}\n`;
    }

    if (faqRecord.metadataSourceType && faqRecord.metadataSourceType.length >= 1) {
        content += `Source Type: ${faqRecord.metadataSourceType}\n`;
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
const createVectorPoint = (faqId: ObjectId, embedding: number[], content: string) => {
    const uuid = uuidv5(`faq-record-${faqId.toString()}`, generateUuidNamespaceDefaultDomain());
    console.log('uuid: ', uuid);

    return {
        id: uuid,
        vector: embedding,
        payload: {
            text: content,
            collectionName: 'faq',
            recordId: faqId.toString(),
            recordType: 'faq-record',
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
 * Main function to generate embedding by FAQ ID
 */
const generateEmbeddingByFaqId = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // Step 1: Find and validate FAQ record
        const faqRecord = await findFaqRecord(targetRecordId);
        if (!faqRecord) {
            // TODO delete FAQ from vector db
            return true;
        }

        const faqId = faqRecord._id as ObjectId;

        // Step 2: Validate API keys
        const apiKeys = await validateApiKeys(faqRecord.username);
        if (!apiKeys) {
            return true;
        }

        // Step 3: Build content from FAQ
        const content = buildContentFromFaq(faqRecord);

        // Step 4: Generate embedding vector
        const embedding = await generateEmbeddingVector(content, apiKeys.apiKeyOllamaEndpoint);

        // Step 5: Create vector point
        const point = createVectorPoint(faqId, embedding, content);

        // Step 6: Setup Qdrant client
        const qdrantClient = await getQdrantClient({
            apiKeyQdrantEndpoint: apiKeys.apiKeyQdrantEndpoint,
            apiKeyQdrantPassword: apiKeys.apiKeyQdrantPassword,
        });

        if (!qdrantClient) {
            return false;
        }

        // collection name
        const collectionName = `index-user-${faqRecord.username}`;

        // Step 7: Ensure collection exists
        await ensureQdrantCollection(qdrantClient, collectionName, embedding.length);

        // Step 8: Upsert to vector database
        await upsertToVectorDb(qdrantClient, collectionName, [point]);

        // Step 9: Update FAQ record with embedding info
        await ModelFaq.updateOne(
            { _id: faqId },
            {
                $set: {
                    hasEmbedding: true,
                    vectorEmbeddingStr: JSON.stringify(embedding),
                }
            }
        );

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default generateEmbeddingByFaqId;

