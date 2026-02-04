import { ModelUser } from '../../../schema/schemaUser/SchemaUser.schema';
import { ModelUserApiKey } from '../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelOpenaiCompatibleModel } from '../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema';

interface DefaultModelResult {
    featureAiActionsEnabled: boolean;
    provider: '' | 'openrouter' | 'groq' | 'ollama' | 'openai-compatible';
    modelName: string;
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
            };
        }

        // If user has AI features enabled and has set a preferred model
        if (
            user.featureAiActionsEnabled &&
            user.featureAiActionsModelProvider.length > 0 &&
            user.featureAiActionsModelName.length > 0
        ) {
            if (
                user.featureAiActionsModelProvider === 'openrouter' ||
                user.featureAiActionsModelProvider === 'groq' ||
                user.featureAiActionsModelProvider === 'ollama' ||
                user.featureAiActionsModelProvider === 'openai-compatible'
            ) {
                return {
                    featureAiActionsEnabled: true,
                    provider: user.featureAiActionsModelProvider,
                    modelName: user.featureAiActionsModelName,
                };
            }
        }

        const userApiKeys = await ModelUserApiKey.findOne({
            username,
        });

        if (!userApiKeys) {
            return {
                featureAiActionsEnabled: true,
                provider: '',
                modelName: '',
            };
        }

        if (userApiKeys.apiKeyGroqValid && userApiKeys.apiKeyGroq) {
            return {
                featureAiActionsEnabled: true,
                provider: 'groq',
                modelName: 'openai/gpt-oss-20b',
            };
        }

        if (userApiKeys.apiKeyOpenrouterValid && userApiKeys.apiKeyOpenrouter) {
            return {
                featureAiActionsEnabled: true,
                provider: 'openrouter',
                modelName: 'openrouter/auto',
            };
        }

        if (userApiKeys.apiKeyOllamaValid && userApiKeys.apiKeyOllamaEndpoint) {
            return {
                featureAiActionsEnabled: true,
                provider: 'ollama',
                modelName: 'openai/gpt-oss-20b',
            };
        }

        // if there exists a model for openai-compatible, return it
        const modelOpenaiCompatible = await ModelOpenaiCompatibleModel.findOne({
            username,

            isInputModalityText: 'true',
            isOutputModalityText: 'true',
        });
        if (modelOpenaiCompatible) {
            return {
                featureAiActionsEnabled: true,
                provider: 'openai-compatible',
                modelName: modelOpenaiCompatible._id.toString(),
            };
        }

        // if no model is found, return false
        return {
            featureAiActionsEnabled: false,
            provider: '',
            modelName: '',
        };
    } catch (error) {
        console.error('Error getting default LLM model:', error);
        return {
            featureAiActionsEnabled: false,
            provider: '',
            modelName: '',
        };
    }
};

export {
    getDefaultLlmModel
};