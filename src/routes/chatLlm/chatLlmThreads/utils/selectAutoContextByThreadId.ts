import mongoose from "mongoose";
import { ModelChatLlm } from "../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelUserApiKey } from "../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelChatLlmThreadContextReference } from "../../../../schema/schemaChatLlm/SchemaChatLlmThreadContextReference.schema";

import { getQdrantClient } from "../../../../config/qdrantConfig";
import { generateEmbedding } from "../../../../utils/llm/ollamaCommonFunc";

import { IChatLlm } from "../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { getMongodbObjectOrNull } from "../../../../utils/common/getMongodbObjectOrNull";
import IUserApiKey from "../../../../types/typesSchema/typesUser/SchemaUserApiKey.types";

interface VectorSearchResult {
    id: string;
    payload: {
        text: string;
        collectionName: string;
        recordId: string;
        recordType: string;
    };
    score: number;
}

/**
 * Perform semantic search using vector database
 */
const performSemanticSearch = async ({
    apiKeys,
    qdrantClient,
    collectionName,
    query,
    recordType,
    limit = 20
}: {
    apiKeys: IUserApiKey;
    qdrantClient: any;
    collectionName: string;
    query: string;
    recordType?: 'notes-record' | 'task-record';
    limit?: number;
}
): Promise<VectorSearchResult[]> => {
    try {
        console.log(`🔍 Performing semantic search for: "${query.substring(0, 50)}..."`);

        // Generate embedding for the query
        const embeddingResult = await generateEmbedding({
            apiKeyOllamaEndpoint: apiKeys.apiKeyOllamaEndpoint,
            text: query,
        });

        if (embeddingResult.error || !embeddingResult.data.embedding.length) {
            console.error('Failed to generate embedding for query:', embeddingResult.error);
            return [];
        }

        const queryVector = embeddingResult.data.embedding;

        // Prepare search parameters
        const searchParams: any = {
            vector: queryVector,
            limit: limit,
            with_payload: true,
            // score_threshold: 0.6, // Lower threshold for more results
        };

        // Add record type filter if specified
        if (recordType) {
            searchParams.filter = {
                must: [
                    {
                        key: 'recordType',
                        match: {
                            value: recordType
                        }
                    }
                ]
            };
        }

        // Perform vector search
        const searchResult = await qdrantClient.search(collectionName, searchParams);

        const results = searchResult.map((result: any) => ({
            id: result.id,
            payload: result.payload,
            score: result.score,
        }));

        console.log(`✅ Found ${results.length} relevant results for query`);
        return results;

    } catch (error) {
        console.error('Error performing semantic search:', error);
        return [];
    }
};

/**
 * Get recent conversations for building context
 */
const getRecentConversationsStr = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}) => {
    try {
        const conversations = await ModelChatLlm.aggregate([
            {
                $match: {
                    username,
                    threadId,
                    type: "text",
                }
            },
            {
                $sort: {
                    createdAtUtc: -1,
                }
            },
            {
                $limit: 20,
            }
        ]) as IChatLlm[];

        let conversationsList = conversations.reverse(); // Chronological order

        let conversationsStr = conversationsList.map((conversation) => conversation.content).join('\n');

        return conversationsStr;
    } catch (error) {
        console.error('Error getting recent conversations:', error);
        return '';
    }
};

/**
 * Validate user API keys
 */
const validateApiKeys = async (username: string) => {
    const apiKeys = await ModelUserApiKey.findOne({
        username: username,
        apiKeyOllamaValid: true,
        apiKeyQdrantValid: true,
    });

    return apiKeys;
};

const selectAutoContextByThreadId = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}) => {
    try {
        console.log('🚀 Starting vector-based auto context selection for thread:', threadId);
        
        // Step 1: Validate API keys
        const apiKeys = await validateApiKeys(username);
        if (!apiKeys) {
            console.log('❌ API keys not valid, skipping vector-based context selection');
            return false;
        }

        // Step 2: Get recent conversations
        const conversationsStr = await getRecentConversationsStr({
            threadId,
            username,
        });

        if (conversationsStr === '') {
            console.log('❌ No conversations found for context selection');
            return false;
        }

        // Step 4: Setup clients
        const qdrantClient = await getQdrantClient({
            apiKeyQdrantEndpoint: apiKeys.apiKeyQdrantEndpoint,
            apiKeyQdrantPassword: apiKeys.apiKeyQdrantPassword,
        });

        const collectionName = `index-user-${username}`;

        // Step 5: Perform semantic search for all queries
        const results = await performSemanticSearch({
            // api keys
            apiKeys,

            // qdrant and ollama
            qdrantClient,
            collectionName,

            // query
            query: conversationsStr,
        });

        console.log(`🔍 Completed semantic search across ${results.length} queries`);

        // Step 6: Insert records
        for (let index = 0; index < results.length; index++) {
            const element = results[index];
            
            if(element.payload.recordType === 'notes') {
                // get note reference by id
                const noteOrTask = await ModelChatLlmThreadContextReference.findOne({
                    referenceFrom: 'notes',
                    referenceId: getMongodbObjectOrNull(element.payload.recordId),
                    threadId,
                    username,
                });
    
                // insert context reference if not exists
                if(!noteOrTask) {
                    await ModelChatLlmThreadContextReference.create({
                        referenceFrom: 'notes',
                        referenceId: getMongodbObjectOrNull(element.payload.recordId),
                        threadId,
                        username,
                    });
                }
            } else if(element.payload.recordType === 'tasks') {
                // get task reference by id
                const noteOrTask = await ModelChatLlmThreadContextReference.findOne({
                    referenceFrom: 'tasks',
                    referenceId: getMongodbObjectOrNull(element.payload.recordId),
                    threadId,
                    username,
                });
    
                // insert context reference if not exists
                if(!noteOrTask) {
                    await ModelChatLlmThreadContextReference.create({
                        referenceFrom: 'tasks',
                        referenceId: getMongodbObjectOrNull(element.payload.recordId),
                        threadId,
                        username,
                    });
                }
            }

        }

        return true;
    } catch (error) {
        console.error('❌ Error in selectAutoContextByThreadId:', error);
        return false;
    }
}

export default selectAutoContextByThreadId;