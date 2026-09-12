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
    provider: 'groq' | 'openrouter' | 'ollama' | 'localai' | 'openai-compatible';
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
    userId,
}: {
    userId: string;
}): Promise<LlmConfig | null> => {
    try {
        // Get user API keys
        const userApiKeyDoc = await ModelUserApiKey.findOne({
            userId: userId,
        });
        if (!userApiKeyDoc) {
            return null;
        }

        const userApiKey = getApiKeyByObject(userApiKeyDoc);

        let llmAuthToken = '';
        let llmEndpoint = '';
        let customHeaders: Record<string, string> | undefined = undefined;
        let selectedProvider: 'groq' | 'openrouter' | 'ollama' | 'localai' | 'openai-compatible' | null = null;
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
        } else if (userApiKey.apiKeyLocalaiValid && userApiKey.apiKeyLocalaiEndpoint) {
            selectedProvider = 'localai';
            llmAuthToken = userApiKey.apiKeyLocalai || '';
            llmEndpoint = userApiKey.apiKeyLocalaiEndpoint;
            modelName = 'gpt-4o-mini'; // Default LocalAI model
        } else {
            // Try openai-compatible as fallback - find first available config for user
            const config = await ModelOpenaiCompatibleModel.findOne({
                userId: userId,
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
    userId,
}: {
    threadId: mongoose.Types.ObjectId;
    userId: string;
}): Promise<string> => {
    try {
        const lastMessages = await ModelChatLlm.aggregate([
            {
                $match: {
                    threadId,
                    userId,
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
            .map((msg) => {
                const content = typeof msg.content === 'string' ? msg.content.trim() : '';
                if (!content) {
                    return '';
                }
                const clipped = content.slice(0, 800);
                if ((msg as IChatLlm).isAi) {
                    return `Assistant: ${clipped}`;
                }
                return `User: ${clipped}`;
            })
            .filter((content) => content.length > 0)
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
            .filter((msg) => msg.type === 'text' && msg.content)
            .map((msg) => {
                const clipped = String(msg.content).trim().slice(0, 800);
                if ((msg as IChatLlm).isAi) {
                    return `Assistant: ${clipped}`;
                }
                return `User: ${clipped}`;
            })
            .join('\n\n');

        if (!messagesContent || messagesContent.trim().length === 0) {
            return [];
        }

        // Prepare LLM messages
        const llmMessages: Message[] = [
            {
                role: 'system',
                content: 'You extract search keywords from a chat. Return JSON {"keywords": [...]} with 12 focused keywords (1-3 words each): named entities, topics, intents. Order most important first. Skip greetings and filler.',
            },
            {
                role: 'user',
                content: `Extract 12 focused keywords (1-3 words each) from this conversation:\n\n${messagesContent}`,
            },
        ];

        // Get LLM configuration - automatically select from available providers
        const llmConfig = await getLlmConfigForThread({
            userId: thread.userId.toString(),
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
            temperature: 0.2,
            maxTokens: 512,
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
                .filter((item) => typeof item === 'string' && item.trim().length > 0)
                .map((item) => item.trim())
                .filter((item, index, arr) => arr.findIndex((v) => v.toLowerCase() === item.toLowerCase()) === index)
                .slice(0, 12);
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
    userId,
    searchResults,
}: {
    threadId: mongoose.Types.ObjectId;
    userId: string;
    searchResults: Array<{
        entityId: mongoose.Types.ObjectId;
        collectionName: string;
        text?: string;
        updatedAtUtc?: Date;
        textScore?: number;
    }>;
}): Promise<RelevantContextResponse['relevantItems']> => {
    try {
        const conversationContext = await getConversationContextByThreadId({
            threadId,
            userId,
        });

        if (!conversationContext) {
            return [];
        }

        const llmConfig = await getLlmConfigForThread({ userId });
        if (!llmConfig) {
            return [];
        }

        const candidatesStr = searchResults
            .map((result) => {
                const rawText = typeof result.text === 'string' ? result.text : '';
                const compactText = rawText.replace(/\s+/g, ' ').trim().slice(0, 500);
                const ageDays = result.updatedAtUtc
                    ? Math.max(0, Math.round((Date.now() - new Date(result.updatedAtUtc).getTime()) / 86_400_000))
                    : -1;
                return [
                    `ID: ${result.entityId.toString()}`,
                    `Collection: ${result.collectionName}`,
                    `AgeDays: ${ageDays}`,
                    `Text: ${compactText}`,
                ].join('\n');
            })
            .join('\n\n');

        const llmMessages: Message[] = [
            {
                role: 'system',
                content: 'Score each candidate 1-10 against the conversation. Prefer direct topic match over keyword overlap; prefer recent items when scores tie; keep at most 3 per collection for diversity. Return ONLY items with score >= 6 as {"relevantItems":[{"entityId":"...", "relevanceScore":7, "relevanceReason":"..."}]} ordered best first.',
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


            const validItems = parsed.relevantItems.filter((item) => {
                return typeof item === 'object'
                    && item !== null
                    && typeof item.entityId === 'string'
                    && typeof item.relevanceScore === 'number'
                    && item.relevanceScore >= 6
                    && typeof item.relevanceReason === 'string';
            }).sort((a, b) => b.relevanceScore - a.relevanceScore);

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
    userId,
    limit = 20,
}: {
    keywords: string[];
    threadId: mongoose.Types.ObjectId;
    userId: string;
    limit?: number;
}): Promise<number> => {
    try {
        if (keywords.length === 0) {
            return 0;
        }

        // Build search query conditions similar to search.route.ts
        const searchQueryLower = keywords
            .map((k) => k.toLowerCase().trim())
            .filter((k) => k.length >= 1);

        if (searchQueryLower.length === 0) {
            return 0;
        }

        type SearchHit = {
            entityId: mongoose.Types.ObjectId;
            collectionName: string;
            text?: string;
            updatedAtUtc?: Date;
            textScore?: number;
        };

        const baseMatch = {
            userId: userId,
            collectionName: { $in: ['tasks', 'notes', 'lifeEvents', 'infoVault', 'memoNotes'] },
        };
        const candidateLimit = limit * 2;
        let searchResults: SearchHit[] = [];

        // Ranked full-text search first (uses the text index), regex fallback second.
        if (searchQueryLower.length > 1) {
            try {
                searchResults = (await ModelGlobalSearch.aggregate([
                    { $match: { ...baseMatch, $text: { $search: searchQueryLower.join(' ') } } },
                    { $addFields: { textScore: { $meta: 'textScore' } } },
                    { $sort: { textScore: { $meta: 'textScore' }, updatedAtUtc: -1 } },
                    { $limit: candidateLimit },
                ])) as SearchHit[];
            } catch (textError) {
                console.warn('Text search failed, falling back to regex:', textError);
                searchResults = [];
            }
        }

        if (searchResults.length === 0) {
            const searchQueryOrConditions = searchQueryLower.map((item) => {
                return { text: { $regex: item, $options: 'i' } };
            });
            searchResults = (await ModelGlobalSearch.aggregate([
                { $match: baseMatch },
                { $match: { $or: searchQueryOrConditions } },
                { $sort: { updatedAtUtc: -1 } },
                { $limit: candidateLimit },
            ])) as SearchHit[];
        }

        if (searchResults.length === 0) {
            return 0;
        }

        const scoredItems = await scoreContextReferencesWithLlm({
            threadId,
            userId,
            searchResults,
        });

        if (scoredItems.length === 0) {
            return 0;
        }

        const allowedEntityIds = new Set(scoredItems.map((item) => item.entityId));

        // Map collectionName to referenceFrom
        const collectionNameToReferenceFrom: Record<string, 'notes' | 'tasks' | 'chatLlm' | 'lifeEvents' | 'infoVault' | 'memo'> = {
            'tasks': 'tasks',
            'notes': 'notes',
            'lifeEvents': 'lifeEvents',
            'infoVault': 'infoVault',
            'chatLlm': 'chatLlm',
            'chatLlmThread': 'chatLlm', // Map chatLlmThread to chatLlm
            'memoNotes': 'memo',
        };

        // Best-first with per-collection diversity cap so one topic cannot crowd out the rest.
        const scoreById = new Map(scoredItems.map((item) => [item.entityId, item.relevanceScore]));
        const perCollectionCount = new Map<string, number>();
        const ranked = searchResults
            .filter((result) => allowedEntityIds.has(result.entityId.toString()))
            .filter((result) => collectionNameToReferenceFrom[result.collectionName])
            .sort((a, b) => (scoreById.get(b.entityId.toString()) || 0) - (scoreById.get(a.entityId.toString()) || 0));
        const diverse = ranked.filter((result) => {
            const count = perCollectionCount.get(result.collectionName) || 0;
            if (count >= 4) {
                return false;
            }
            perCollectionCount.set(result.collectionName, count + 1);
            return true;
        }).slice(0, limit);

        if (diverse.length === 0) {
            return 0;
        }

        const existing = await ModelChatLlmThreadContextReference.find({
            threadId,
            userId,
            referenceId: { $in: diverse.map((result) => result.entityId) },
        }).select('referenceId').lean();
        const existingIds = new Set(existing.map((doc) => String(doc.referenceId)));

        const now = new Date();
        const docsToInsert = diverse
            .filter((result) => !existingIds.has(result.entityId.toString()))
            .map((result) => ({
                threadId,
                userId,
                referenceFrom: collectionNameToReferenceFrom[result.collectionName],
                referenceId: result.entityId,
                isAddedByAi: true,
                createdAtUtc: now,
                updatedAtUtc: now,
            }));

        if (docsToInsert.length === 0) {
            return 0;
        }

        await ModelChatLlmThreadContextReference.insertMany(docsToInsert, { ordered: false });

        return docsToInsert.length;
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
            userId: thread.userId.toString(),
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