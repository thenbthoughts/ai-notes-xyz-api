import { ModelOpenaiCompatibleModel } from "../../../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema";
import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";

export interface LlmConfig {
    provider: 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
    apiKey: string;
    apiEndpoint: string;
    model: string;
    customHeaders?: Record<string, string>;
}

/**
 * Service for managing LLM configuration
 */
export class LlmConfigService {

    /**
     * Get LLM configuration for a user/thread
     */
    static async getLlmConfigForUser(username: string, threadId?: string): Promise<LlmConfig | null> {
        try {
            // Get user API keys first (needed for both thread-specific and default logic)
            const userApiKey = await ModelUserApiKey.findOne({
                username: username,
            });
            if (!userApiKey) {
                console.warn(`[LLM Config] No API keys found for user: ${username}`);
                return null;
            }

            // First check if thread has specific model settings
            if (threadId) {
                const thread = await ModelChatLlmThread.findById(threadId);
                console.log(`[LLM Config] Thread ${threadId} model settings:`, {
                    aiModelProvider: thread?.aiModelProvider,
                    aiModelName: thread?.aiModelName,
                    aiModelOpenAiCompatibleConfigId: thread?.aiModelOpenAiCompatibleConfigId
                });
                if (thread && thread.aiModelProvider && thread.aiModelName) {
                    console.log(`[LLM Config] Using thread-specific model: ${thread.aiModelProvider} - ${thread.aiModelName}`);

                    let llmAuthToken = '';
                    let llmEndpoint = '';
                    let customHeaders: Record<string, string> | undefined = undefined;

                    if (thread.aiModelProvider === 'groq' && userApiKey.apiKeyGroqValid && userApiKey.apiKeyGroq) {
                        llmAuthToken = userApiKey.apiKeyGroq;
                        llmEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
                    } else if (thread.aiModelProvider === 'openrouter' && userApiKey.apiKeyOpenrouterValid && userApiKey.apiKeyOpenrouter) {
                        llmAuthToken = userApiKey.apiKeyOpenrouter;
                        llmEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
                    } else if (thread.aiModelProvider === 'ollama' && userApiKey.apiKeyOllamaValid && userApiKey.apiKeyOllamaEndpoint) {
                        llmAuthToken = '';
                        llmEndpoint = userApiKey.apiKeyOllamaEndpoint;
                    } else if (thread.aiModelProvider === 'openai-compatible' && thread.aiModelOpenAiCompatibleConfigId) {
                        const openAiCompatibleModel = await ModelOpenaiCompatibleModel.findOne({
                            _id: thread.aiModelOpenAiCompatibleConfigId,
                            username: username,
                        });
                        if (openAiCompatibleModel) {
                            llmAuthToken = openAiCompatibleModel.apiKey;
                            llmEndpoint = openAiCompatibleModel.baseUrl;
                            // Parse customHeaders from string to object if it exists
                            if (openAiCompatibleModel.customHeaders && openAiCompatibleModel.customHeaders.trim()) {
                                try {
                                    customHeaders = JSON.parse(openAiCompatibleModel.customHeaders);
                                } catch (e) {
                                    console.warn(`[LLM Config] Failed to parse customHeaders for thread: ${threadId}`);
                                }
                            }
                        } else {
                            console.warn(`[LLM Config] Invalid openai-compatible config for thread: ${threadId}`);
                            return null;
                        }
                    } else {
                        console.warn(`[LLM Config] Thread specifies provider ${thread?.aiModelProvider} but no valid API key available, falling back to default`);
                        // Fall through to default logic
                    }

                    // If we successfully configured for the thread's provider, return it
                    if (llmAuthToken !== '' || thread.aiModelProvider === 'ollama') {
                        return {
                            provider: thread.aiModelProvider as LlmConfig['provider'],
                            apiKey: llmAuthToken,
                            apiEndpoint: llmEndpoint,
                            model: thread.aiModelName,
                            customHeaders,
                        };
                    }
                } else {
                    console.log(`[LLM Config] Thread ${threadId} has no specific model settings, using default logic`);
                }
            }

            // Default selection logic (when no thread-specific settings)
            let llmAuthToken = '';
            let llmEndpoint = '';
            let customHeaders: Record<string, string> | undefined = undefined;
            let selectedProvider: LlmConfig['provider'] | null = null;
            let modelName = '';

            // Select provider in priority order: groq > openrouter > ollama > openai-compatible
            if (userApiKey.apiKeyGroqValid && userApiKey.apiKeyGroq) {
                selectedProvider = 'groq';
                llmAuthToken = userApiKey.apiKeyGroq;
                modelName = 'llama3-8b-8192';
                llmEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
            } else if (userApiKey.apiKeyOpenrouterValid && userApiKey.apiKeyOpenrouter) {
                selectedProvider = 'openrouter';
                llmAuthToken = userApiKey.apiKeyOpenrouter;
                modelName = 'meta-llama/llama-3.1-8b-instruct';
                llmEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
            } else if (userApiKey.apiKeyOllamaValid && userApiKey.apiKeyOllamaEndpoint) {
                selectedProvider = 'ollama';
                llmAuthToken = '';
                llmEndpoint = userApiKey.apiKeyOllamaEndpoint;
                modelName = 'llama3.1'; // Default Ollama model
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
        } catch (error: any) {
            console.error('[LLM Config] Error getting LLM config for user:', username, error);
            return null;
        }
    }

    /**
     * Validate LLM configuration
     */
    static validateConfig(config: LlmConfig | null): boolean {
        if (!config) return false;

        return !!(
            config.apiKey &&
            config.apiEndpoint &&
            config.model &&
            config.provider
        );
    }

    /**
     * Get default configuration for testing
     */
    static getDefaultConfig(): LlmConfig {
        return {
            provider: 'groq',
            apiKey: 'test-key',
            apiEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
            model: 'llama3-8b-8192',
        };
    }
}