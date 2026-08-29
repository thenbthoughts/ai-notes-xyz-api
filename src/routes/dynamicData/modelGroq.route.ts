import mongoose from 'mongoose';
import { Router, Request, Response } from 'express';
import { ModelAiListGroq } from '../../schema/schemaDynamicData/SchemaGroqModel.schema';
import { ModelAiModelModality } from '../../schema/schemaDynamicData/SchemaAiModelModality.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelLlmPendingTaskCron } from '../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import llmPendingTaskProcessFunc from '../../utils/llmPendingTask/llmPendingTaskProcessFunc';
import groqModelGet from '../../utils/llmPendingTask/page/settings/groqModelGet';

// Router
const router = Router();

// Get Model Groq API
router.get('/modelGroqGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // pipeline
        const resultAiListGroq = await ModelAiListGroq.find({});

        if(resultAiListGroq.length === 0) {
            await groqModelGet({
                userId: res.locals.auth_userId,
                force: true,
            });
            const freshDocs = await ModelAiListGroq.find({});
            return res.json({
                message: 'Ai List Groq retrieved successfully',
                count: freshDocs.length,
                docs: freshDocs,
            });
        }

        return res.json({
            message: 'Ai List Groq retrieved successfully',
            count: resultAiListGroq.length,
            docs: resultAiListGroq,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Model Groq API
router.post('/modelGroqAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const result = await groqModelGet({
            userId: res.locals.auth_userId,
            force: true,
        });
        if (!result) {
            return res.status(400).json({ message: 'Error fetching GROQ models. Make sure your API key is valid.' });
        }

        return res.json({
            message: 'GROQ models refreshed successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Pull All Groq Models API
router.post('/modelGroqPullAll', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const result = await groqModelGet({
            userId: res.locals.auth_userId,
            force: true,
        });
        if (!result) {
            return res.status(400).json({ message: 'Error fetching GROQ models. Make sure your API key is valid.' });
        }

        return res.json({
            message: 'GROQ models fetched successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Update GROQ Model (Manual edit)
router.patch('/modelGroqUpdate', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const {
            _id,
            id,
            owned_by,
            active,
            contextLength,
            context_window,
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

        if (typeof owned_by === 'string') update.owned_by = owned_by.trim();
        if (typeof active === 'boolean') update.active = active;

        const ctx = typeof contextLength === 'number' ? contextLength : (typeof context_window === 'number' ? context_window : undefined);
        if (ctx !== undefined) {
            update.contextLength = Math.max(0, ctx);
            update.context_window = Math.max(0, ctx);
        }

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
        const updated = await ModelAiListGroq.findOneAndUpdate(query, { $set: update }, { new: true });

        if (!updated) {
            return res.status(404).json({ message: 'GROQ model not found' });
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
                { provider: 'groq', modalIdString: updated.id },
                { $set: modalityUpdate },
                { upsert: true }
            );
        }

        return res.json({
            message: 'GROQ model updated successfully',
            doc: updated,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;