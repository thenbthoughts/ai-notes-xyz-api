import mongoose from 'mongoose';
import { Router, Request, Response } from 'express';
import { Ollama } from 'ollama';
import { ModelAiListOllama } from '../../schema/schemaDynamicData/SchemaOllamaModel.schema';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';

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
            // Construct model name with parameters and quantization
            let modelLabel = `${model.name}`.trim();
            if (model.details?.parameter_size?.length > 0) {
                modelLabel += ` (${model.details?.parameter_size})`;
            }
            if (model.details?.quantization_level?.length > 0) {
                modelLabel += ` (${model.details?.quantization_level})`;
            }
            modelLabel = modelLabel.trim();

            modelsToInsert.push({
                username: username,
                modelLabel: modelLabel,
                modelName: model.name,
                raw: model,
            });
        }

        // Clear existing models for this user and insert new ones
        await ModelAiListOllama.deleteMany({
            username: username
        });

        await ModelAiListOllama.insertMany(modelsToInsert);

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
        const deletedModel = await ModelAiListOllama.findOneAndDelete({
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