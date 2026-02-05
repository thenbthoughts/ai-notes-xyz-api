import { ModelUser } from '../../../schema/schemaUser/SchemaUser.schema';
import { ModelUserApiKey } from '../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelOpenaiCompatibleModel } from '../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema';

interface DefaultModelResult {
    featureAiActionsEnabled: boolean;
    provider: '' | 'openrouter' | 'groq' | 'ollama' | 'openai-compatible';
    apiEndpoint: string;
    modelName: string;
    apiKey: string;
}

const getDefaultLlmModel = async (username: string): Promise<DefaultModelResult> => {
    try {
        // Find user and get their AI preferences
        const user = await ModelUser.findOne({
            username,
            featureAiActionsEnabled: true,
        });

        if (!user) {
            return {
                featureAiActionsEnabled: false,
                provider: '',
                modelName: '',
                apiKey: '',
                apiEndpoint: '',
            };
        }

        const userApiKeys = await ModelUserApiKey.findOne({
            username,
        });

        let featureAiActionsModelName = user.featureAiActionsModelName || '';

        // If user has AI features enabled and has set a preferred model
        if (
            user.featureAiActionsEnabled &&
            user.featureAiActionsModelProvider.length > 0 &&
            featureAiActionsModelName.length > 0
        ) {
            if (
                user.featureAiActionsModelProvider === 'openrouter' ||
                user.featureAiActionsModelProvider === 'groq' ||
                user.featureAiActionsModelProvider === 'ollama' ||
                user.featureAiActionsModelProvider === 'openai-compatible'
            ) {
                let apiKey = '';
                let apiEndpoint = '';

                // Get API key and endpoint for the preferred provider
                if (userApiKeys) {
                    if (user.featureAiActionsModelProvider === 'groq' && userApiKeys.apiKeyGroqValid && userApiKeys.apiKeyGroq) {
                        apiKey = userApiKeys.apiKeyGroq;
                    } else if (user.featureAiActionsModelProvider === 'openrouter' && userApiKeys.apiKeyOpenrouterValid && userApiKeys.apiKeyOpenrouter) {
                        apiKey = userApiKeys.apiKeyOpenrouter;
                    } else if (user.featureAiActionsModelProvider === 'ollama' && userApiKeys.apiKeyOllamaValid && userApiKeys.apiKeyOllamaEndpoint) {
                        apiEndpoint = userApiKeys.apiKeyOllamaEndpoint;
                    } else if (user.featureAiActionsModelProvider === 'openai-compatible') {
                        // For openai-compatible, we need to get the model configuration
                        const openaiModel = await ModelOpenaiCompatibleModel.findById(featureAiActionsModelName);
                        console.log('openaimodel: ', openaiModel);
                        if (openaiModel) {
                            apiKey = openaiModel.apiKey || '';
                            // Construct the API endpoint like the calling code does
                            apiEndpoint = openaiModel.baseUrl || '';
                            featureAiActionsModelName = openaiModel.modelName;
                        }
                    }
                }

                return {
                    featureAiActionsEnabled: true,
                    provider: user.featureAiActionsModelProvider,
                    modelName: featureAiActionsModelName,
                    apiKey,
                    apiEndpoint,
                };
            }
        }

        if (!userApiKeys) {
            return {
                featureAiActionsEnabled: true,
                provider: '',
                modelName: '',
                apiKey: '',
                apiEndpoint: '',
            };
        }

        if (userApiKeys.apiKeyOpenrouterValid && userApiKeys.apiKeyOpenrouter) {
            return {
                featureAiActionsEnabled: true,
                provider: 'openrouter',
                modelName: 'openrouter/auto',
                apiKey: userApiKeys.apiKeyOpenrouter,
                apiEndpoint: '',
            };
        }

        if (userApiKeys.apiKeyGroqValid && userApiKeys.apiKeyGroq) {
            return {
                featureAiActionsEnabled: true,
                provider: 'groq',
                modelName: 'openai/gpt-oss-20b',
                apiKey: userApiKeys.apiKeyGroq,
                apiEndpoint: '',
            };
        }


        if (userApiKeys.apiKeyOllamaValid && userApiKeys.apiKeyOllamaEndpoint) {
            return {
                featureAiActionsEnabled: true,
                provider: 'ollama',
                modelName: 'gemma3:1b',
                apiKey: '',
                apiEndpoint: userApiKeys.apiKeyOllamaEndpoint,
            };
        }

        // if there exists a model for openai-compatible, return it
        const modelOpenaiCompatible = await ModelOpenaiCompatibleModel.findOne({
            username,
            isInputModalityText: 'true',
            isOutputModalityText: 'true',
            modelName: { $not: /ocr/i },
        }).sort({ createdAtUtc: -1 }); // Get the most recent one
        if (modelOpenaiCompatible) {
            // Construct the API endpoint like the calling code does
            let apiEndpoint = modelOpenaiCompatible.baseUrl || '';

            return {
                featureAiActionsEnabled: true,
                provider: 'openai-compatible',
                modelName: modelOpenaiCompatible.modelName,
                apiKey: modelOpenaiCompatible.apiKey || '',
                apiEndpoint,
            };
        }

        // if no model is found, return false
        return {
            featureAiActionsEnabled: false,
            provider: '',
            modelName: '',
            apiKey: '',
            apiEndpoint: '',
        };
    } catch (error) {
        console.error('Error getting default LLM model:', error);
        return {
            featureAiActionsEnabled: false,
            provider: '',
            modelName: '',
            apiKey: '',
            apiEndpoint: '',
        };
    }
};

export {
    getDefaultLlmModel
};