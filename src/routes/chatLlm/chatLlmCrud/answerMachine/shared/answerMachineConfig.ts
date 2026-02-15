import { ModelOpenaiCompatibleModel } from "../../../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema";
import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { getApiKeyByObject } from "../../../../../utils/llm/llmCommonFunc";

interface LlmConfig {
    provider: 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
    apiKey: string;
    apiEndpoint: string;
    model: string;
    customHeaders?: Record<string, string>;
}

export const getLlmConfigForThread = async ({
    username,
}: {
    username: string;
}): Promise<LlmConfig | null> => {
    try {
        // Get user API keys
        const userApiKey = await ModelUserApiKey.findOne({
            username: username,
        });
        if (!userApiKey) {
            return null;
        }

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