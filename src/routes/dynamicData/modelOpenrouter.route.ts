import mongoose from 'mongoose';
import { Router, Request, Response } from 'express';
import { ModelAiListOpenrouter } from '../../schema/schemaDynamicData/SchemaOpenrouterModel.schema';
import { ModelAiModelModality } from '../../schema/schemaDynamicData/SchemaAiModelModality.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelLlmPendingTaskCron } from '../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import llmPendingTaskProcessFunc from '../../utils/llmPendingTask/llmPendingTaskProcessFunc';
import openRouterModelGet from '../../utils/llmPendingTask/page/settings/openRouterModelGet';

// Router
const router = Router();

// Get Model Openrouter API
router.get('/modelOpenrouterGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // pipeline
        const resultAiListOpenrouter = await ModelAiListOpenrouter.find({});

        if(resultAiListOpenrouter.length === 0) {
            await openRouterModelGet({ force: true });
            const freshDocs = await ModelAiListOpenrouter.find({});
            return res.json({
                message: 'Ai List Openrouter retrieved successfully',
                count: freshDocs.length,
                docs: freshDocs,
            });
        }

        return res.json({
            message: 'Ai List Openrouter retrieved successfully',
            count: resultAiListOpenrouter.length,
            docs: resultAiListOpenrouter,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Model Openrouter API
router.post('/modelOpenrouterAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const result = await openRouterModelGet({ force: true });
        if (!result) {
            return res.status(400).json({ message: 'Failed to refresh OpenRouter models' });
        }

        return res.json({
            message: 'Model Openrouter refreshed successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Pull All OpenRouter Models API
router.post('/modelOpenrouterPullAll', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const result = await openRouterModelGet({ force: true });
        if (!result) {
            return res.status(400).json({ message: 'Error fetching OpenRouter models' });
        }

        return res.json({
            message: 'OpenRouter models fetched successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Update OpenRouter Model (Manual edit)
router.patch('/modelOpenrouterUpdate', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const {
            _id,
            id,
            name,
            description,
            contextLength,
            maxCompletionTokens,
            isInputModalityText,
            isInputModalityImage,
            isInputModalityAudio,
            isInputModalityVideo,
            isOutputModalityText,
            isOutputModalityImage,
            isOutputModalityAudio,
            isOutputModalityVideo,
            isOutputModalityEmbedding,
        } = req.body;

        if (!_id && !id) {
            return res.status(400).json({ message: 'Model ID is required' });
        }

        const validModalityValues = ['true', 'false', 'pending'] as const;
        const update: Record<string, any> = {};

        if (typeof name === 'string') update.name = name.trim();
        if (typeof description === 'string') update.description = description.trim();
        if (typeof contextLength === 'number') update.contextLength = Math.max(0, contextLength);
        if (typeof maxCompletionTokens === 'number') update.maxCompletionTokens = Math.max(0, maxCompletionTokens);

        if (isInputModalityText !== undefined && validModalityValues.includes(isInputModalityText)) update.isInputModalityText = isInputModalityText;
        if (isInputModalityImage !== undefined && validModalityValues.includes(isInputModalityImage)) update.isInputModalityImage = isInputModalityImage;
        if (isInputModalityAudio !== undefined && validModalityValues.includes(isInputModalityAudio)) update.isInputModalityAudio = isInputModalityAudio;
        if (isInputModalityVideo !== undefined && validModalityValues.includes(isInputModalityVideo)) update.isInputModalityVideo = isInputModalityVideo;

        if (isOutputModalityText !== undefined && validModalityValues.includes(isOutputModalityText)) update.isOutputModalityText = isOutputModalityText;
        if (isOutputModalityImage !== undefined && validModalityValues.includes(isOutputModalityImage)) update.isOutputModalityImage = isOutputModalityImage;
        if (isOutputModalityAudio !== undefined && validModalityValues.includes(isOutputModalityAudio)) update.isOutputModalityAudio = isOutputModalityAudio;
        if (isOutputModalityVideo !== undefined && validModalityValues.includes(isOutputModalityVideo)) update.isOutputModalityVideo = isOutputModalityVideo;
        if (isOutputModalityEmbedding !== undefined && validModalityValues.includes(isOutputModalityEmbedding)) update.isOutputModalityEmbedding = isOutputModalityEmbedding;

        if (Object.keys(update).length === 0) {
            return res.status(400).json({ message: 'No valid fields provided to update' });
        }

        const query = _id ? { _id } : { id };
        const updated = await ModelAiListOpenrouter.findOneAndUpdate(query, { $set: update }, { new: true });

        if (!updated) {
            return res.status(404).json({ message: 'OpenRouter model not found' });
        }

        // Sync with ModelAiModelModality
        const modalityUpdate: Record<string, any> = {};
        if (update.contextLength !== undefined) modalityUpdate.contextLength = update.contextLength;
        if (update.maxCompletionTokens !== undefined) modalityUpdate.maxCompletionTokens = update.maxCompletionTokens;
        if (update.isInputModalityText !== undefined) modalityUpdate.isInputModalityText = update.isInputModalityText;
        if (update.isInputModalityImage !== undefined) modalityUpdate.isInputModalityImage = update.isInputModalityImage;
        if (update.isInputModalityAudio !== undefined) modalityUpdate.isInputModalityAudio = update.isInputModalityAudio;
        if (update.isInputModalityVideo !== undefined) modalityUpdate.isInputModalityVideo = update.isInputModalityVideo;
        if (update.isOutputModalityText !== undefined) modalityUpdate.isOutputModalityText = update.isOutputModalityText;
        if (update.isOutputModalityImage !== undefined) modalityUpdate.isOutputModalityImage = update.isOutputModalityImage;
        if (update.isOutputModalityAudio !== undefined) modalityUpdate.isOutputModalityAudio = update.isOutputModalityAudio;
        if (update.isOutputModalityVideo !== undefined) modalityUpdate.isOutputModalityVideo = update.isOutputModalityVideo;
        if (update.isOutputModalityEmbedding !== undefined) modalityUpdate.isOutputModalityEmbedding = update.isOutputModalityEmbedding;

        if (Object.keys(modalityUpdate).length > 0) {
            await ModelAiModelModality.findOneAndUpdate(
                { provider: 'openrouter', modalIdString: updated.id },
                { $set: modalityUpdate },
                { upsert: true }
            );
        }

        return res.json({
            message: 'OpenRouter model updated successfully',
            doc: updated,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;