import mongoose from 'mongoose';
import { Router, Request, Response } from 'express';
import { Ollama } from 'ollama';
import { ModelAiListOllama } from '../../schema/schemaDynamicData/SchemaOllamaModel.schema';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { fetchLlmUnified } from "../../utils/llmPendingTask/utils/fetchLlmUnified";
import { ModelAiModelStoreModalityOllama } from '../../schema/schemaDynamicData/SchemaOllamaStoreModalityModel.schema';

// Router
const router = Router();

const ollamaPullAllModelsFunc = async ({
    username,
}: {
    username: string;
}): Promise<{
    success: boolean;
    message: string;
}> => {
    try {
        const userApiKey = await ModelUserApiKey.findOne({
            username: username
        });

        if (!userApiKey || !userApiKey.apiKeyOllamaEndpoint) {
            return {
                success: false,
                message: 'Ollama endpoint not configured',
            }
        }

        const ollama = new Ollama({
            host: userApiKey.apiKeyOllamaEndpoint,
        });

        // Get all models from /api/tags
        console.log('Getting all models from /api/tags');
        const modelsList = await ollama.list();

        // Insert all models into database
        const modelsToInsert = [];
        for (const model of modelsList.models) {
            // check if model is already in database
            let isInputModalityText = 'pending';
            let isInputModalityImage = 'pending';
            let isInputModalityAudio = 'false';
            let isInputModalityVideo = 'false';

            const modelStoreModality = await ModelAiModelStoreModalityOllama.findOne({
                username: username,
                modelName: model.name,
            });
            if (modelStoreModality) {
                isInputModalityText = modelStoreModality.isInputModalityText;
                isInputModalityImage = modelStoreModality.isInputModalityImage;
                isInputModalityAudio = modelStoreModality.isInputModalityAudio;
                isInputModalityVideo = modelStoreModality.isInputModalityVideo;
            }

            // Construct model name with parameters and quantization
            let modelLabel = `${model.name}`.trim();
            if(isInputModalityImage === 'true') {
                modelLabel += ` (Image)`;
            }
            if (model.details?.parameter_size?.length > 0) {
                modelLabel += ` (${model.details?.parameter_size})`;
            }
            if (model.details?.quantization_level?.length > 0) {
                modelLabel += ` (${model.details?.quantization_level})`;
            }
            modelLabel = modelLabel.trim();

            modelsToInsert.push({
                // ai
                username: username,
                modelLabel: modelLabel,
                modelName: model.name,

                // input modalities
                isInputModalityText: isInputModalityText,
                isInputModalityImage: isInputModalityImage,
                isInputModalityAudio: isInputModalityAudio,
                isInputModalityVideo: isInputModalityVideo,

                raw: model,
            });
        }

        // Clear existing models for this user and insert new ones
        await ModelAiListOllama.deleteMany({
            username: username
        });

        let modelsToInsertSort = modelsToInsert.sort((a, b) => {
            return a.modelLabel.localeCompare(b.modelLabel);
        });

        await ModelAiListOllama.insertMany(modelsToInsertSort);

        return {
            success: true,
            message: 'Ollama models fetched successfully',
        }
    } catch (error) {
        console.error(error);
        return {
            success: false,
            message: 'Error fetching all models',
        }
    }
}

export const ollamaInsertModelModality = async ({
    modelName,
    provider,
    username,
}: {
    modelName: string;
    provider: string;
    username: string;
}) => {
    try {
        // Get user API key
        const userApiKey = await ModelUserApiKey.findOne({ username });
        if (!userApiKey) {
            throw new Error('No user API key');
        }

        // check if model is already in database
        const modelStoreModality = await ModelAiModelStoreModalityOllama.findOne({
            username: username,
            modelName: modelName,
        });
        if (modelStoreModality) {
            return {
                isInputModalityText: modelStoreModality.isInputModalityText,
                isInputModalityImage: modelStoreModality.isInputModalityImage,
                isInputModalityAudio: modelStoreModality.isInputModalityAudio,
                isInputModalityVideo: modelStoreModality.isInputModalityVideo,
            };
        }

        let isText: 'true' | 'false' | 'pending' = 'pending';
        let isImage: 'true' | 'false' | 'pending' = 'pending';
        let isAudio: 'true' | 'false' = 'false';
        let isVideo: 'true' | 'false' = 'false';

        if (provider === 'ollama' && userApiKey.apiKeyOllamaEndpoint) {
            // Test text modality using fetchLlmUnified
            try {
                console.log('Testing text modality for model: ', modelName);
                const resultText = await fetchLlmUnified({
                    provider: 'ollama',
                    apiKey: '',
                    apiEndpoint: userApiKey.apiKeyOllamaEndpoint,
                    model: modelName,
                    messages: [
                        { role: 'system', content: "You are a helpful assistant. Give short answer." },
                        { role: 'user', content: "Hi" }
                    ],
                    temperature: 0,
                    maxTokens: 20
                });
                console.log('resultText: ', resultText);
                if (resultText && typeof resultText.content === 'string' && resultText.content.length > 0) {
                    isText = 'true';
                } else {
                    isText = 'false';
                }
            } catch {
                isText = 'false';
            }

            // Test image modality using Ollama's /api/show endpoint
            try {
                const showUrl = `${userApiKey.apiKeyOllamaEndpoint.replace(/\/$/, '')}/api/show`;
                const response = await fetch(showUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: modelName
                    })
                });

                if (response.ok) {
                    const modelInfo = await response.json();
                    console.log('Model info for', modelName, ':', modelInfo);

                    // Check if 'vision' is in the capabilities array
                    if (modelInfo.capabilities && Array.isArray(modelInfo.capabilities)) {
                        isImage = modelInfo.capabilities.includes('vision') ? 'true' : 'false';
                    } else {
                        isImage = 'false';
                    }
                } else {
                    console.warn(`Failed to get model info for ${modelName}:`, response.statusText);
                    isImage = 'false';
                }
            } catch (error) {
                console.warn(`Error checking vision capability for ${modelName}:`, error);
                isImage = 'false';
            }
        } else {
            isText = 'false';
            isImage = 'false';
        }

        // insert into database
        await ModelAiModelStoreModalityOllama.deleteMany({
            username: username,
            modelName: modelName,
        });
        await ModelAiModelStoreModalityOllama.create({
            username: username,
            modelName: modelName,
            isInputModalityText: isText,
            isInputModalityImage: isImage,
            isInputModalityAudio: isAudio,
            isInputModalityVideo: isVideo,
        });

        return {
            isInputModalityText: isText,
            isInputModalityImage: isImage,
            isInputModalityAudio: isAudio,
            isInputModalityVideo: isVideo,
        };
    } catch (error) {
        console.error('insertModelModality error:', error);
        return {
            isInputModalityText: 'false',
            isInputModalityImage: 'false',
            isInputModalityAudio: 'false',
            isInputModalityVideo: 'false',
        };
    }
}

// Get Ollama Models
router.get('/modelOllamaGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const models = await ModelAiListOllama.find({
            username: res.locals.auth_username
        });

        return res.json({
            message: 'Ollama models retrieved successfully',
            count: models.length,
            docs: models,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Ollama Models
router.post('/modelOllamaAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { modelName } = req.body;

        if (!modelName || typeof modelName !== 'string') {
            return res.status(400).json({ message: 'Model name is required' });
        }

        // Get user API key
        const userApiKey = await ModelUserApiKey.findOne({
            username: res.locals.auth_username
        });

        if (!userApiKey || !userApiKey.apiKeyOllamaEndpoint) {
            return res.status(400).json({ message: 'Ollama endpoint not configured' });
        }

        const ollama = new Ollama({
            host: userApiKey.apiKeyOllamaEndpoint,
        });

        // Download/pull the model
        console.log(`Pulling model: ${modelName}`);
        await ollama.pull({ model: modelName });

        // Update model modality
        const resultModelModality = await ollamaInsertModelModality({
            modelName: modelName,
            provider: 'ollama',
            username: res.locals.auth_username,
        });
        console.log('resultModelModality: ', resultModelModality);

        // Pull all models
        const resultOllamaPullAllModels = await ollamaPullAllModelsFunc({
            username: res.locals.auth_username,
        });

        if (!resultOllamaPullAllModels.success) {
            return res.status(400).json({ message: resultOllamaPullAllModels.message });
        }

        return res.json({
            message: resultOllamaPullAllModels.message,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Ollama Model
router.delete('/modelOllamaDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { modelName } = req.body;

        if (!modelName || typeof modelName !== 'string') {
            return res.status(400).json({ message: 'Model name is required' });
        }

        // Get user API key
        const userApiKey = await ModelUserApiKey.findOne({
            username: res.locals.auth_username
        });

        if (!userApiKey || !userApiKey.apiKeyOllamaEndpoint) {
            return res.status(400).json({ message: 'Ollama endpoint not configured' });
        }

        const ollama = new Ollama({
            host: userApiKey.apiKeyOllamaEndpoint,
        });

        // Delete model from Ollama server
        console.log(`Deleting model from Ollama: ${modelName}`);
        await ollama.delete({ model: modelName });

        // Delete from database
        await ModelAiListOllama.findOneAndDelete({
            username: res.locals.auth_username,
            modelName: modelName,
        });

        await ModelAiModelStoreModalityOllama.findOneAndDelete({
            username: res.locals.auth_username,
            modelName: modelName,
        });

        await ollamaPullAllModelsFunc({
            username: res.locals.auth_username,
        });

        return res.json({
            message: 'Ollama model deleted successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Pull All Ollama Models
router.post('/modelOllamaPullAll', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const resultOllamaPullAllModels = await ollamaPullAllModelsFunc({
            username: res.locals.auth_username,
        });

        if (!resultOllamaPullAllModels.success) {
            return res.status(400).json({ message: resultOllamaPullAllModels.message });
        }

        return res.json({
            message: resultOllamaPullAllModels.message,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;