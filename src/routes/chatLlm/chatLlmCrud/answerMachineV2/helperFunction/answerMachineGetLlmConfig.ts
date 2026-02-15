import mongoose from "mongoose";
import { ModelOpenaiCompatibleModel } from "../../../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema";
import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { getApiKeyByObject } from "../../../../../utils/llm/llmCommonFunc";

export interface LlmConfig {
    provider: 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
    apiKey: string;
    apiEndpoint: string;
    model: string;
    customHeaders?: Record<string, string>;
}

export const getLlmConfig = async ({
    threadId,
}: {
    threadId: mongoose.Types.ObjectId;
}) => {
    try {
        const thread = await ModelChatLlmThread.findById(threadId);
        if (!thread) {
            return null;
        }
        const username = thread.username;

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

        // Use thread's model settings if available, otherwise use default priority
        if (thread.aiModelProvider && thread.aiModelName) {
            selectedProvider = thread.aiModelProvider as 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
            modelName = thread.aiModelName;

            if (selectedProvider === 'groq' && userApiKey.apiKeyGroqValid && userApiKey.apiKeyGroq) {
                llmAuthToken = userApiKey.apiKeyGroq;
            } else if (selectedProvider === 'openrouter' && userApiKey.apiKeyOpenrouterValid && userApiKey.apiKeyOpenrouter) {
                llmAuthToken = userApiKey.apiKeyOpenrouter;
            } else if (selectedProvider === 'ollama' && userApiKey.apiKeyOllamaValid && userApiKey.apiKeyOllamaEndpoint) {
                llmEndpoint = userApiKey.apiKeyOllamaEndpoint;
            } else if (selectedProvider === 'openai-compatible' && thread.aiModelOpenAiCompatibleConfigId) {
                const config = await ModelOpenaiCompatibleModel.findById(thread.aiModelOpenAiCompatibleConfigId);
                if (config && config.apiKey && config.baseUrl) {
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
                }
            }
        }

        // Fallback to default priority if thread settings not available or invalid
        if (!selectedProvider || !llmAuthToken && selectedProvider !== 'ollama' || selectedProvider === 'ollama' && !llmEndpoint) {
            if (userApiKey.apiKeyGroqValid && userApiKey.apiKeyGroq) {
                selectedProvider = 'groq';
                llmAuthToken = userApiKey.apiKeyGroq;
                modelName = 'openai/gpt-oss-20b';
            } else if (userApiKey.apiKeyOpenrouterValid && userApiKey.apiKeyOpenrouter) {
                selectedProvider = 'openrouter';
                llmAuthToken = userApiKey.apiKeyOpenrouter;
                modelName = 'openai/gpt-oss-20b';
            } else if (userApiKey.apiKeyOllamaValid && userApiKey.apiKeyOllamaEndpoint) {
                selectedProvider = 'ollama';
                llmEndpoint = userApiKey.apiKeyOllamaEndpoint;
                modelName = 'llama3.2';
            } else {
                const config = await ModelOpenaiCompatibleModel.findOne({
                    username: username,
                }).sort({ createdAtUtc: -1 });

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
                        modelName = 'gpt-4o-mini';
                    }
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
        console.error('Error in getLlmConfig:', error);
        return null;
    }
}