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
    userId,
}: {
    userId: mongoose.Types.ObjectId;
}): Promise<{
    success: boolean;
    message: string;
}> => {
    try {
        const userApiKey = await ModelUserApiKey.findOne({
            userId: userId
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
        const showUrl = `${userApiKey.apiKeyOllamaEndpoint.replace(/\/$/, '')}/api/show`;

        for (const model of modelsList.models) {
            // check if model is already in database
            const modelLower = (model.name || '').toLowerCase();
            const isEmbed = modelLower.includes('embed') || modelLower.includes('bge-') || modelLower.includes('minilm');
            const isVision = modelLower.includes('vision') || modelLower.includes('llava') || modelLower.includes('bakllava') || modelLower.includes('moondream');

            let isInputModalityText = 'true';
            let isInputModalityImage = isVision ? 'true' : 'false';
            let isInputModalityAudio = 'false';
            let isInputModalityVideo = 'false';
            let isOutputModalityText = isEmbed ? 'false' : 'true';
            let isOutputModalityImage = 'false';
            let isOutputModalityAudio = 'false';
            let isOutputModalityVideo = 'false';
            let isOutputModalityEmbedding = isEmbed ? 'true' : 'false';
            let contextLength = 0;
            let maxCompletionTokens = 0;
            let showDetails: any = null;

            // Fetch live detailed model info from real Ollama API /api/show
            try {
                const showRes = await fetch(showUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: model.name }),
                });
                if (showRes.ok) {
                    showDetails = await showRes.json();
                }
            } catch (e) {
                console.warn(`Could not fetch /api/show for ${model.name}:`, e);
            }

            if (showDetails) {
                // Extract capabilities
                if (Array.isArray(showDetails.capabilities)) {
                    if (showDetails.capabilities.includes('vision')) {
                        isInputModalityImage = 'true';
                    }
                    if (showDetails.capabilities.includes('embedding')) {
                        isOutputModalityEmbedding = 'true';
                        isOutputModalityText = 'false';
                    }
                }

                // Extract context length from model_info
                if (showDetails.model_info && typeof showDetails.model_info === 'object') {
                    for (const [k, v] of Object.entries(showDetails.model_info)) {
                        if (k.endsWith('.context_length') && typeof v === 'number') {
                            contextLength = v;
                            break;
                        }
                    }
                }

                // Extract num_ctx and num_predict from parameters
                if (typeof showDetails.parameters === 'string') {
                    const ctxMatch = showDetails.parameters.match(/num_ctx\s+(\d+)/i);
                    if (ctxMatch && ctxMatch[1]) {
                        const parsed = parseInt(ctxMatch[1], 10);
                        if (!Number.isNaN(parsed) && parsed > 0) {
                            contextLength = parsed;
                        }
                    }

                    const predictMatch = showDetails.parameters.match(/num_predict\s+(\d+)/i);
                    if (predictMatch && predictMatch[1]) {
                        const parsed = parseInt(predictMatch[1], 10);
                        if (!Number.isNaN(parsed) && parsed > 0) {
                            maxCompletionTokens = parsed;
                        }
                    }
                }
            }

            const modelStoreModality = await ModelAiModelStoreModalityOllama.findOne({
                userId: userId,
                modelName: model.name,
            });
            if (modelStoreModality) {
                isInputModalityText = modelStoreModality.isInputModalityText || isInputModalityText;
                isInputModalityImage = modelStoreModality.isInputModalityImage || isInputModalityImage;
                isInputModalityAudio = modelStoreModality.isInputModalityAudio || isInputModalityAudio;
                isInputModalityVideo = modelStoreModality.isInputModalityVideo || isInputModalityVideo;
                isOutputModalityText = modelStoreModality.isOutputModalityText || isOutputModalityText;
                isOutputModalityImage = modelStoreModality.isOutputModalityImage || isOutputModalityImage;
                isOutputModalityAudio = modelStoreModality.isOutputModalityAudio || isOutputModalityAudio;
                isOutputModalityVideo = modelStoreModality.isOutputModalityVideo || isOutputModalityVideo;
                isOutputModalityEmbedding = modelStoreModality.isOutputModalityEmbedding || isOutputModalityEmbedding;
                if (modelStoreModality.contextLength && modelStoreModality.contextLength > 0) {
                    contextLength = modelStoreModality.contextLength;
                }
                if (modelStoreModality.maxCompletionTokens && modelStoreModality.maxCompletionTokens > 0) {
                    maxCompletionTokens = modelStoreModality.maxCompletionTokens;
                }
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

            const mergedRaw = {
                ...model,
                ...(showDetails ? {
                    template: showDetails.template,
                    system: showDetails.system,
                    parameters: showDetails.parameters,
                    capabilities: showDetails.capabilities,
                    model_info: showDetails.model_info,
                    license: showDetails.license,
                } : {}),
            };

            modelsToInsert.push({
                // ai
                userId: userId,
                modelLabel: modelLabel,
                modelName: model.name,

                // input modalities
                isInputModalityText: isInputModalityText,
                isInputModalityImage: isInputModalityImage,
                isInputModalityAudio: isInputModalityAudio,
                isInputModalityVideo: isInputModalityVideo,

                // output modalities
                isOutputModalityText: isOutputModalityText,
                isOutputModalityImage: isOutputModalityImage,
                isOutputModalityAudio: isOutputModalityAudio,
                isOutputModalityVideo: isOutputModalityVideo,
                isOutputModalityEmbedding: isOutputModalityEmbedding,

                contextLength: contextLength,
                maxCompletionTokens: maxCompletionTokens,

                raw: mergedRaw,
            });
        }

        // Clear existing models for this user and insert new ones
        await ModelAiListOllama.deleteMany({
            userId: userId
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
    userId,
}: {
    modelName: string;
    provider: string;
    userId: mongoose.Types.ObjectId;
}) => {
    try {
        // Get user API key
        const userApiKey = await ModelUserApiKey.findOne({ userId });
        if (!userApiKey) {
            throw new Error('No user API key');
        }

        // check if model is already in database
        const modelStoreModality = await ModelAiModelStoreModalityOllama.findOne({
            userId: userId,
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
        let isOutputText: 'true' | 'false' = 'true';
        let isOutputImage: 'true' | 'false' = 'false';
        let isOutputAudio: 'true' | 'false' = 'false';
        let isOutputVideo: 'true' | 'false' = 'false';
        let isOutputEmbedding: 'true' | 'false' = 'false';
        let contextLength = 0;
        let maxCompletionTokens = 0;

        const modelLower = modelName.toLowerCase();
        if (modelLower.includes('embed') || modelLower.includes('bge-') || modelLower.includes('minilm')) {
            isOutputEmbedding = 'true';
            isOutputText = 'false';
        }

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

                    // Extract context length if available
                    if (modelInfo.model_info) {
                        const info = modelInfo.model_info;
                        for (const key of Object.keys(info)) {
                            if (key.endsWith('.context_length') && typeof info[key] === 'number') {
                                contextLength = info[key];
                                break;
                            }
                        }
                    }

                    // Extract num_ctx and num_predict from parameters if present
                    if (typeof modelInfo.parameters === 'string') {
                        const ctxMatch = modelInfo.parameters.match(/num_ctx\s+(\d+)/i);
                        if (ctxMatch && ctxMatch[1] && contextLength === 0) {
                            contextLength = parseInt(ctxMatch[1], 10) || 0;
                        }
                        const predictMatch = modelInfo.parameters.match(/num_predict\s+(\d+)/i);
                        if (predictMatch && predictMatch[1]) {
                            maxCompletionTokens = parseInt(predictMatch[1], 10) || 0;
                        }
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
            userId: userId,
            modelName: modelName,
        });
        await ModelAiModelStoreModalityOllama.create({
            userId: userId,
            modelName: modelName,
            isInputModalityText: isText,
            isInputModalityImage: isImage,
            isInputModalityAudio: isAudio,
            isInputModalityVideo: isVideo,
            isOutputModalityText: isOutputText,
            isOutputModalityImage: isOutputImage,
            isOutputModalityAudio: isOutputAudio,
            isOutputModalityVideo: isOutputVideo,
            isOutputModalityEmbedding: isOutputEmbedding,
            contextLength: contextLength,
            maxCompletionTokens: maxCompletionTokens,
        });

        return {
            isInputModalityText: isText,
            isInputModalityImage: isImage,
            isInputModalityAudio: isAudio,
            isInputModalityVideo: isVideo,
            isOutputModalityText: isOutputText,
            isOutputModalityImage: isOutputImage,
            isOutputModalityAudio: isOutputAudio,
            isOutputModalityVideo: isOutputVideo,
            isOutputModalityEmbedding: isOutputEmbedding,
            contextLength: contextLength,
            maxCompletionTokens: maxCompletionTokens,
        };
    } catch (error) {
        console.error('insertModelModality error:', error);
        return {
            isInputModalityText: 'false',
            isInputModalityImage: 'false',
            isInputModalityAudio: 'false',
            isInputModalityVideo: 'false',
            isOutputModalityText: 'false',
            isOutputModalityImage: 'false',
            isOutputModalityAudio: 'false',
            isOutputModalityVideo: 'false',
            isOutputModalityEmbedding: 'false',
            contextLength: 0,
            maxCompletionTokens: 0,
        };
    }
}

// Update Ollama Model Modality/ContextLength
router.patch('/modelOllamaUpdate', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const {
            _id,
            modelLabel,
            isInputModalityText,
            isInputModalityImage,
            isInputModalityAudio,
            isInputModalityVideo,
            isOutputModalityText,
            isOutputModalityImage,
            isOutputModalityAudio,
            isOutputModalityVideo,
            isOutputModalityEmbedding,
            contextLength,
            maxCompletionTokens,
        } = req.body;

        if (!_id || typeof _id !== 'string') {
            return res.status(400).json({ message: 'Model _id is required' });
        }

        const validModalityValues = ['true', 'false', 'pending'] as const;
        const update: Record<string, any> = {};

        if (typeof modelLabel === 'string' && modelLabel.trim()) {
            update.modelLabel = modelLabel.trim();
        }
        if (isInputModalityText !== undefined && validModalityValues.includes(isInputModalityText)) {
            update.isInputModalityText = isInputModalityText;
        }
        if (isInputModalityImage !== undefined && validModalityValues.includes(isInputModalityImage)) {
            update.isInputModalityImage = isInputModalityImage;
        }
        if (isInputModalityAudio !== undefined && validModalityValues.includes(isInputModalityAudio)) {
            update.isInputModalityAudio = isInputModalityAudio;
        }
        if (isInputModalityVideo !== undefined && validModalityValues.includes(isInputModalityVideo)) {
            update.isInputModalityVideo = isInputModalityVideo;
        }
        if (isOutputModalityText !== undefined && validModalityValues.includes(isOutputModalityText)) {
            update.isOutputModalityText = isOutputModalityText;
        }
        if (isOutputModalityImage !== undefined && validModalityValues.includes(isOutputModalityImage)) {
            update.isOutputModalityImage = isOutputModalityImage;
        }
        if (isOutputModalityAudio !== undefined && validModalityValues.includes(isOutputModalityAudio)) {
            update.isOutputModalityAudio = isOutputModalityAudio;
        }
        if (isOutputModalityVideo !== undefined && validModalityValues.includes(isOutputModalityVideo)) {
            update.isOutputModalityVideo = isOutputModalityVideo;
        }
        if (isOutputModalityEmbedding !== undefined && validModalityValues.includes(isOutputModalityEmbedding)) {
            update.isOutputModalityEmbedding = isOutputModalityEmbedding;
        }
        if (typeof contextLength === 'number') {
            update.contextLength = Math.max(0, contextLength);
        }
        if (typeof maxCompletionTokens === 'number') {
            update.maxCompletionTokens = Math.max(0, maxCompletionTokens);
        }

        if (Object.keys(update).length === 0) {
            return res.status(400).json({ message: 'No valid fields to update' });
        }

        const updated = await ModelAiListOllama.findOneAndUpdate(
            { userId: res.locals.auth_userId, _id },
            { $set: update },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: 'Model not found' });
        }

        // Also sync to store modality
        await ModelAiModelStoreModalityOllama.findOneAndUpdate(
            { userId: res.locals.auth_userId, modelName: updated.modelName },
            { $set: update },
            { upsert: true }
        );

        return res.json({
            message: 'Ollama model updated successfully',
            doc: updated,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Get Ollama Models
router.get('/modelOllamaGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const models = await ModelAiListOllama.find({
            userId: res.locals.auth_userId
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
            userId: res.locals.auth_userId
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
            userId: res.locals.auth_userId,
        });
        console.log('resultModelModality: ', resultModelModality);

        // Pull all models
        const resultOllamaPullAllModels = await ollamaPullAllModelsFunc({
            userId: res.locals.auth_userId,
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
            userId: res.locals.auth_userId
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
            userId: res.locals.auth_userId,
            modelName: modelName,
        });

        await ModelAiModelStoreModalityOllama.findOneAndDelete({
            userId: res.locals.auth_userId,
            modelName: modelName,
        });

        await ollamaPullAllModelsFunc({
            userId: res.locals.auth_userId,
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
            userId: res.locals.auth_userId,
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