import mongoose from 'mongoose';
import { Router, Request, Response } from 'express';
import axios, { AxiosRequestConfig } from 'axios';
import { ModelAiListLocalai } from '../../schema/schemaDynamicData/SchemaLocalaiModel.schema';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';

// Router
const router = Router();

const localaiPullAllModelsFunc = async ({
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

        if (!userApiKey || !userApiKey.apiKeyLocalaiEndpoint) {
            return {
                success: false,
                message: 'LocalAI endpoint not configured',
            }
        }

        // Get all models from LocalAI /v1/models (OpenAI-compatible format)
        console.log('Getting all models from LocalAI /v1/models');
        const modelsUrl = `${userApiKey.apiKeyLocalaiEndpoint.replace(/\/$/, '')}/v1/models`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (userApiKey.apiKeyLocalai && userApiKey.apiKeyLocalai.trim()) {
            headers['Authorization'] = `Bearer ${userApiKey.apiKeyLocalai}`;
        }

        const config: AxiosRequestConfig = {
            method: 'get',
            url: modelsUrl,
            headers: headers,
            timeout: 10000, // 10 second timeout
        };

        const response = await axios.request(config);

        if (!response.data?.data || !Array.isArray(response.data.data)) {
            return {
                success: false,
                message: 'Invalid response format from LocalAI API',
            };
        }

        // Insert all models into database
        const modelsToInsert = [];
        for (const model of response.data.data) {
            // LocalAI returns models in OpenAI format: { id, object, created, owned_by }
            if (!model.id) continue;

            // Construct model label from model ID
            let modelLabel = model.id.trim();

            modelsToInsert.push({
                // ai
                username: username,
                modelLabel: modelLabel,
                modelName: model.id,

                // input modalities - default to pending for LocalAI (no detection mechanism)
                isInputModalityText: 'pending',
                isInputModalityImage: 'pending',
                isInputModalityAudio: 'false',
                isInputModalityVideo: 'false',

                raw: model,
            });
        }

        // Clear existing models for this user and insert new ones
        await ModelAiListLocalai.deleteMany({
            username: username
        });

        let modelsToInsertSort = modelsToInsert.sort((a, b) => {
            return a.modelLabel.localeCompare(b.modelLabel);
        });

        if (modelsToInsertSort.length > 0) {
            await ModelAiListLocalai.insertMany(modelsToInsertSort);
        }

        return {
            success: true,
            message: `LocalAI models fetched successfully. ${modelsToInsertSort.length} models synced.`,
        }
    } catch (error) {
        console.error('LocalAI pull models error:', error);
        return {
            success: false,
            message: 'Error fetching models from LocalAI API',
        }
    }
}

// Get LocalAI Models
router.get('/modelLocalaiGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const models = await ModelAiListLocalai.find({
            username: res.locals.auth_username
        });

        return res.json({
            message: 'LocalAI models retrieved successfully',
            count: models.length,
            docs: models,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Pull All LocalAI Models
router.post('/modelLocalaiPullAll', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const resultLocalaiPullAllModels = await localaiPullAllModelsFunc({
            username: res.locals.auth_username,
        });

        if (!resultLocalaiPullAllModels.success) {
            return res.status(400).json({ message: resultLocalaiPullAllModels.message });
        }

        return res.json({
            message: resultLocalaiPullAllModels.message,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete LocalAI Model
router.delete('/modelLocalaiDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { modelName } = req.body;

        if (!modelName || typeof modelName !== 'string') {
            return res.status(400).json({ message: 'Model name is required' });
        }

        // Delete from database only (no server-side delete for LocalAI)
        await ModelAiListLocalai.findOneAndDelete({
            username: res.locals.auth_username,
            modelName: modelName,
        });

        return res.json({
            message: 'LocalAI model deleted successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;