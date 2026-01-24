import mongoose from "mongoose";

import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelOpenaiCompatibleModel } from "../../../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema";
import { ModelGlobalSearch } from "../../../../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema";
import { ModelChatLlmThreadContextReference } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThreadContextReference.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { fetchLlmUnified, Message } from "../../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { getApiKeyByObject } from "../../../../../utils/llm/llmCommonFunc";
import { IChatLlmThread } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types";

interface LlmConfig {
    provider: 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
    apiKey: string;
    apiEndpoint: string;
    model: string;
    customHeaders?: Record<string, string>;
}

interface RelevantContextResponse {
    relevantItems: {
        entityId: string;
        relevanceScore: number;
        relevanceReason: string;
    }[];
}

const getLlmConfigForThread = async ({
    username,
}: {
    username: string;
}): Promise<LlmConfig | null> => {
    try {
        // Get user API keys
        const userApiKeyDoc = await ModelUserApiKey.findOne({
            username: username,
        });
        if (!userApiKeyDoc) {
            return null;
        }

        const userApiKey = getApiKeyByObject(userApiKeyDoc);

        let llmAuthToken = '';
        let llmEndpoint = '';
        let customHeaders: Record<string, string> | undefined = undefined;
        let selectedProvider: 'groq' | 'openrouter' | 'ollama' | 'openai-compatible' | null = null;
        let modelName = '';

        // Select provider in priority order: groq > openrouter > ollama > openai-compatible
        if (userApiKey.apiKeyGroqValid && userApiKey.apiKeyGroq) {
            selectedProvider = 'groq';
            llmAuthToken = userApiKey.apiKeyGroq;
            modelName = 'openai/gpt-oss-20b'; // Default Groq model
        } else if (userApiKey.apiKeyOpenrouterValid && userApiKey.apiKeyOpenrouter) {
            selectedProvider = 'openrouter';
            llmAuthToken = userApiKey.apiKeyOpenrouter;
            modelName = 'openai/gpt-oss-20b'; // Default OpenRouter model
        } else if (userApiKey.apiKeyOllamaValid && userApiKey.apiKeyOllamaEndpoint) {
            selectedProvider = 'ollama';
            llmAuthToken = '';
            llmEndpoint = userApiKey.apiKeyOllamaEndpoint;
            modelName = 'llama3.2'; // Default Ollama model
        } else {
            // Try openai-compatible as fallback - find first available config for user
            const config = await ModelOpenaiCompatibleModel.findOne({
                username: username,
            }).sort({ createdAtUtc: -1 }); // Get most recent config

            if (config && config.apiKey && config.baseUrl) {
                selectedProvider = 'openai-compatible';
                llmAuthToken = config.apiKey;
                let baseUrl = config.baseUrl.trim();
                if (!baseUrl.endsWith('/chat/completions')) {
                    baseUrl = baseUrl.replace(/\/$/, '') + '/chat/completions';
                }
                llmEndpoint = baseUrl;

                if (config.customHeaders && config.customHeaders.trim()) {
                    try {
                        customHeaders = JSON.parse(config.customHeaders);
                    } catch (e) {
                        console.error('Error parsing custom headers:', e);
                    }
                }

                if (config.modelName && config.modelName.trim()) {
                    modelName = config.modelName;
                } else {
                    modelName = 'gpt-4o-mini'; // Default OpenAI-compatible model
                }
            }
        }

        if (!selectedProvider) {
            return null;
        }

        if (!llmAuthToken && selectedProvider !== 'ollama') {
            return null;
        }
        if (selectedProvider === 'ollama' && !llmEndpoint) {
            return null;
        }

        return {
            provider: selectedProvider,
            apiKey: llmAuthToken,
            apiEndpoint: llmEndpoint,
            model: modelName,
            customHeaders,
        };
    } catch (error) {
        console.error('Error in getLlmConfigForThread:', error);
        return null;
    }
};

const getConversationContextByThreadId = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
}): Promise<string> => {
    try {
        const lastMessages = await ModelChatLlm.aggregate([
            {
                $match: {
                    threadId,
                    username,
                    type: 'text',
                }
            },
            {
                $sort: {
                    createdAtUtc: -1,
                }
            },
            {
                $limit: 10,
            },
            {
                $sort: {
                    createdAtUtc: 1,
                }
            }
        ]) as IChatLlm[];

        const conversationContext = lastMessages
            .map(msg => msg.content)
            .filter(content => typeof content === 'string' && content.trim().length > 0)
            .join('\n')
            .trim();

        return conversationContext;
    } catch (error) {
        console.error('Error in getConversationContextByThreadId:', error);
        return '';
    }
};

const createKeywordsFromThread = async ({
    threadId,
}: {
    threadId: mongoose.Types.ObjectId;
}) => {
    try {
        const thread = await ModelChatLlmThread.findById(threadId);
        if (!thread) {
            return [];
        }

        // last 10 messages
        const last10Messages = await ModelChatLlm.aggregate([
            {
                $match: {
                    threadId,
                }
            },
            {
                $sort: {
                    createdAtUtc: -1,
                }
            },
            {
                $limit: 10,
            },
            {
                $sort: {
                    createdAtUtc: 1,
                }
            }
        ]) as IChatLlm[];

        if (last10Messages.length === 0) {
            return [];
        }

        // Prepare messages for LLM
        const messagesContent = last10Messages
            .filter(msg => msg.type === 'text' && msg.content)
            .map(msg => msg.content)
            .join('\n\n');

        if (!messagesContent || messagesContent.trim().length === 0) {
            return [];
        }

        // Prepare LLM messages
        const llmMessages: Message[] = [
            {
                role: 'system',
                content: 'You are a helpful assistant that extracts keywords from conversations. Generate a JSON object with a "keywords" property containing an array of relevant SHORT keywords (around 50 keywords, each 1-3 words maximum) that summarize the main topics discussed. Keep keywords concise and specific. Example: {"keywords": ["API design", "database", "authentication", "React hooks", "error handling", "TypeScript", "REST API", "MongoDB", "user auth", "JWT tokens"]}',
            },
            {
                role: 'user',
                content: `Extract around 50 SHORT keywords (1-3 words each) from the following conversation:\n\n${messagesContent}`,
            },
        ];

        // Get LLM configuration - automatically select from available providers
        const llmConfig = await getLlmConfigForThread({
            username: thread.username,
        });

        if (!llmConfig) {
            return [];
        }

        // Call fetchLlmUnified
        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: llmMessages,
            temperature: 0.7,
            maxTokens: 4096,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
        });

        if (!llmResult.success || !llmResult.content) {
            console.error('Failed to generate keywords:', llmResult.error);
            return [];
        }

        try {
            const parsed = JSON.parse(llmResult.content);
            let keywords: string[] = [];

            if (Array.isArray(parsed)) {
                keywords = parsed;
            } else if (parsed?.keywords && Array.isArray(parsed.keywords)) {
                keywords = parsed.keywords;
            } else if (parsed && typeof parsed === 'object') {
                const values = Object.values(parsed);
                const arrayValue = values.find(value => Array.isArray(value)) as string[] | undefined;
                if (arrayValue) {
                    keywords = arrayValue;
                }
            }

            return keywords
                .filter(item => typeof item === 'string' && item.trim().length > 0)
                .map(item => item.trim())
                .slice(0, 10);
        } catch (parseError) {
            console.error('Failed to parse keywords JSON:', parseError);
            return [];
        }

    } catch (error) {
        console.error('Error in createKeywordsFromThread:', error);
        return [];
    }
}

const scoreContextReferencesWithLlm = async ({
    threadId,
    username,
    searchResults,
}: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    searchResults: Array<{
        entityId: mongoose.Types.ObjectId;
        collectionName: string;
        text?: string;
    }>;
}): Promise<RelevantContextResponse['relevantItems']> => {
    try {
        const conversationContext = await getConversationContextByThreadId({
            threadId,
            username,
        });

        if (!conversationContext) {
            return [];
        }

        const llmConfig = await getLlmConfigForThread({ username });
        if (!llmConfig) {
            return [];
        }

        const candidatesStr = searchResults
            .map(result => {
                const rawText = typeof result.text === 'string' ? result.text : '';
                const compactText = rawText.replace(/\s+/g, ' ').trim().slice(0, 600);
                return [
                    `ID: ${result.entityId.toString()}`,
                    `Collection: ${result.collectionName}`,
                    `Text: ${compactText}`,
                ].join('\n');
            })
            .join('\n\n');

        const llmMessages: Message[] = [
            {
                role: 'system',
                content: 'You are an AI assistant that evaluates relevance between a conversation and candidate context items. For each candidate, assign a relevanceScore (1-10) and a brief relevanceReason. Return ONLY items with relevanceScore >= 6. Respond in JSON format: {"relevantItems":[{"entityId":"...", "relevanceScore":7, "relevanceReason":"..."}]}',
            },
            {
                role: 'user',
                content: `CONVERSATION CONTEXT:\n${conversationContext}\n\nCANDIDATES:\n${candidatesStr}`,
            },
        ];

        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages: llmMessages,
            temperature: 0.2,
            maxTokens: 4096,
            responseFormat: 'json_object',
            headersExtra: llmConfig.customHeaders,
        });

        if (!llmResult.success || !llmResult.content) {
            console.error('Failed to score context references:', llmResult.error);
            return [];
        }

        try {
            const parsed = JSON.parse(llmResult.content) as RelevantContextResponse;

            if (!parsed || typeof parsed !== 'object') {
                console.error('Invalid context response: not an object');
                return [];
            }

            if (!parsed.relevantItems || !Array.isArray(parsed.relevantItems)) {
                console.error('Invalid context response: relevantItems not found or not an array');
                return [];
            }


            const validItems = parsed.relevantItems.filter(item => {
                return typeof item === 'object'
                    && item !== null
                    && typeof item.entityId === 'string'
                    && typeof item.relevanceScore === 'number'
                    && item.relevanceScore >= 6
                    && typeof item.relevanceReason === 'string';
            });

            if (validItems.length === 0) {
                console.error('No valid context items found with relevanceScore >= 6');
                return [];
            }

            return validItems;
        } catch (parseError) {
            console.error('Failed to parse context relevance JSON:', parseError);
            return [];
        }
    } catch (error) {
        console.error('Error in scoreContextReferencesWithLlm:', error);
        return [];
    }
};

const searchAndAddContextReferences = async ({
    keywords,
    threadId,
    username,
    limit = 20,
}: {
    keywords: string[];
    threadId: mongoose.Types.ObjectId;
    username: string;
    limit?: number;
}): Promise<number> => {
    try {
        if (keywords.length === 0) {
            return 0;
        }

        // Build search query conditions similar to search.route.ts
        const searchQueryLower = keywords
            .map(k => k.toLowerCase().trim())
            .filter(k => k.length >= 1);

        if (searchQueryLower.length === 0) {
            return 0;
        }

        const searchQueryOrConditions = searchQueryLower.map(item => {
            return { text: { $regex: item, $options: 'i' } };
        });

        const matchConditionsSearch = {
            $or: searchQueryOrConditions,
        };

        // Search global search by keywords
        const searchResults = await ModelGlobalSearch.aggregate([
            {
                $match: {
                    username: username,
                    collectionName: { $in: ['tasks', 'notes', 'lifeEvents', 'infoVault'] }
                }
            },
            { $sort: { updatedAtUtc: -1 } },
            { $match: matchConditionsSearch },
            { $sort: { updatedAtUtc: -1 } },
            { $limit: limit },
        ]) as Array<{
            entityId: mongoose.Types.ObjectId;
            collectionName: string;
            text?: string;
        }>;

        if (searchResults.length === 0) {
            return 0;
        }

        const scoredItems = await scoreContextReferencesWithLlm({
            threadId,
            username,
            searchResults,
        });

        if (scoredItems.length === 0) {
            return 0;
        }

        const allowedEntityIds = new Set(scoredItems.map(item => item.entityId));

        // Map collectionName to referenceFrom
        const collectionNameToReferenceFrom: Record<string, 'notes' | 'tasks' | 'chatLlm' | 'lifeEvents' | 'infoVault'> = {
            'tasks': 'tasks',
            'notes': 'notes',
            'lifeEvents': 'lifeEvents',
            'infoVault': 'infoVault',
            'chatLlm': 'chatLlm',
            'chatLlmThread': 'chatLlm', // Map chatLlmThread to chatLlm
        };

        let insertedCount = 0;

        // Insert context references
        for (const result of searchResults) {
            const referenceFrom = collectionNameToReferenceFrom[result.collectionName];
            const entityIdString = result.entityId.toString();

            // Skip if collectionName is not supported
            if (!referenceFrom) {
                continue;
            }

            // Skip if relevance score is not high enough
            if (!allowedEntityIds.has(entityIdString)) {
                continue;
            }

            // Check if reference already exists
            const existingReference = await ModelChatLlmThreadContextReference.findOne({
                threadId,
                username,
                referenceFrom,
                referenceId: result.entityId,
            });

            if (!existingReference) {
                // Insert new reference
                await ModelChatLlmThreadContextReference.create({
                    threadId,
                    username,
                    referenceFrom,
                    referenceId: result.entityId,
                    isAddedByAi: true,
                    createdAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                });
                insertedCount++;
            }
        }

        return insertedCount;
    } catch (error) {
        console.error('Error in searchAndAddContextReferences:', error);
        return 0;
    }
};

const autoContextSelectByMethodSearch = async ({
    threadId,
}: {
    threadId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    errorReason: string;
    data: {
        keywords: string[];
        insertedContextReferences: number;
    };
}> => {
    try {
        const thread = await ModelChatLlmThread.findById(threadId) as IChatLlmThread;
        if (!thread) {
            return {
                success: false,
                errorReason: 'Thread not found',
                data: {
                    keywords: [],
                    insertedContextReferences: 0,
                }
            };
        }

        const keywords = await createKeywordsFromThread({
            threadId: thread._id as mongoose.Types.ObjectId,
        });

        // Search global search using keywords and add to context references
        const insertedCount = await searchAndAddContextReferences({
            keywords,
            threadId: thread._id as mongoose.Types.ObjectId,
            username: thread.username,
        });

        return {
            success: true,
            errorReason: '',
            data: {
                keywords,
                insertedContextReferences: insertedCount,
            }
        }
    } catch (error) {
        console.error('Error in autoContextSelectByThreadId:', error);
        return {
            success: false,
            errorReason: 'Internal server error',
            data: {
                keywords: [],
                insertedContextReferences: 0,
            }
        };
    }
}

export default autoContextSelectByMethodSearch;