import { Router, Request, Response } from 'express';
import axios from 'axios';
import { ModelAiListLocalai } from '../../schema/schemaDynamicData/SchemaLocalaiModel.schema';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';

// Router
const router = Router();

type LocalaiModelType = '' | 'llm' | 'stt' | 'tts' | 'embedding' | 'image-generation';

const normalizeText = (value: string | undefined | null): string => {
    return (value || '').toLowerCase();
};

const detectLocalaiModelType = (
    modelId: string,
    modelTags?: string[],
): LocalaiModelType => {
    const normalizedTags = Array.isArray(modelTags)
        ? modelTags.map((tag) => normalizeText(tag))
        : [];
    const hasTag = (values: string[]): boolean => values.some((value) => normalizedTags.includes(value));

    if (hasTag(['tts', 'text-to-speech'])) {
        return 'tts';
    }

    if (hasTag(['stt', 'speech-to-text', 'whisper'])) {
        return 'stt';
    }

    if (hasTag(['embedding'])) {
        return 'embedding';
    }

    if (hasTag(['text-to-image', 'image-generation', 'image'])) {
        return 'image-generation';
    }

    if (hasTag(['llm'])) {
        return 'llm';
    }

    const normalizedModelId = normalizeText(modelId);

    if (normalizedModelId.includes('tts') || normalizedModelId.includes('text-to-speech')) {
        return 'tts';
    }

    if (normalizedModelId.includes('stt') || normalizedModelId.includes('speech-to-text') || normalizedModelId.includes('whisper')) {
        return 'stt';
    }

    if (normalizedModelId.includes('embed')) {
        return 'embedding';
    }

    if (normalizedModelId.includes('image') || normalizedModelId.includes('img')) {
        return 'image-generation';
    }

    return '';
};

const getModalitySettingsByType = (modelType: LocalaiModelType): {
    isInputModalityText: 'true' | 'false' | 'pending';
    isInputModalityImage: 'true' | 'false' | 'pending';
    isInputModalityAudio: 'true' | 'false' | 'pending';
    isInputModalityVideo: 'true' | 'false' | 'pending';
    isOutputModalityText: 'true' | 'false' | 'pending';
    isOutputModalityImage: 'true' | 'false' | 'pending';
    isOutputModalityAudio: 'true' | 'false' | 'pending';
    isOutputModalityVideo: 'true' | 'false' | 'pending';
    isOutputModalityEmbedding: 'true' | 'false' | 'pending';
} => {
    if (modelType === 'llm') {
        return {
            isInputModalityText: 'true',
            isInputModalityImage: 'false',
            isInputModalityAudio: 'false',
            isInputModalityVideo: 'false',
            isOutputModalityText: 'true',
            isOutputModalityImage: 'false',
            isOutputModalityAudio: 'false',
            isOutputModalityVideo: 'false',
            isOutputModalityEmbedding: 'false',
        };
    }

    if (modelType === 'tts') {
        return {
            isInputModalityText: 'true',
            isInputModalityImage: 'false',
            isInputModalityAudio: 'false',
            isInputModalityVideo: 'false',
            isOutputModalityText: 'false',
            isOutputModalityImage: 'false',
            isOutputModalityAudio: 'true',
            isOutputModalityVideo: 'false',
            isOutputModalityEmbedding: 'false',
        };
    }

    if (modelType === 'stt') {
        return {
            isInputModalityText: 'false',
            isInputModalityImage: 'false',
            isInputModalityAudio: 'true',
            isInputModalityVideo: 'false',
            isOutputModalityText: 'true',
            isOutputModalityImage: 'false',
            isOutputModalityAudio: 'false',
            isOutputModalityVideo: 'false',
            isOutputModalityEmbedding: 'false',
        };
    }

    if (modelType === 'image-generation') {
        return {
            isInputModalityText: 'false',
            isInputModalityImage: 'true',
            isInputModalityAudio: 'false',
            isInputModalityVideo: 'false',
            isOutputModalityText: 'false',
            isOutputModalityImage: 'true',
            isOutputModalityAudio: 'false',
            isOutputModalityVideo: 'false',
            isOutputModalityEmbedding: 'false',
        };
    }

    if (modelType === 'embedding') {
        return {
            isInputModalityText: 'true',
            isInputModalityImage: 'false',
            isInputModalityAudio: 'false',
            isInputModalityVideo: 'false',
            isOutputModalityText: 'false',
            isOutputModalityImage: 'false',
            isOutputModalityAudio: 'false',
            isOutputModalityVideo: 'false',
            isOutputModalityEmbedding: 'true',
        };
    }

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
    };
};

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

        const baseLocalaiUrl = userApiKey.apiKeyLocalaiEndpoint.replace(/\/$/, '');

        // 1) Get all models from LocalAI /v1/models (OpenAI-compatible format)
        console.log('Getting all models from LocalAI /v1/models');
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (userApiKey.apiKeyLocalai && userApiKey.apiKeyLocalai.trim()) {
            headers['Authorization'] = `Bearer ${userApiKey.apiKeyLocalai}`;
        }

        const modelsResponse = await axios.get(`${baseLocalaiUrl}/v1/models`, {
            headers,
            timeout: 10000, // 10 second timeout
        });

        const modelTypesByName = new Map<string, string[]>();
        try {
            const availableModelsResponse = await axios.get(`${baseLocalaiUrl}/models/available`, {
                headers,
                timeout: 10000, // 10 second timeout
            });
            const availableModelsRaw = Array.isArray(availableModelsResponse.data?.data)
                ? availableModelsResponse.data.data
                : Array.isArray(availableModelsResponse.data)
                    ? availableModelsResponse.data
                    : [];

            for (const availableModel of availableModelsRaw) {
                const rawId = normalizeText(availableModel?.id);
                if (!rawId) continue;

                const tags = Array.isArray(availableModel?.tags)
                    ? availableModel.tags.filter((tag: unknown) => typeof tag === 'string') as string[]
                    : [];

                if (tags.length > 0) {
                    modelTypesByName.set(rawId, tags);
                }
            }
        } catch (availableError) {
            console.error('Unable to fetch /models/available tags from LocalAI:', availableError);
        }

        if (!modelsResponse.data?.data || !Array.isArray(modelsResponse.data.data)) {
            return {
                success: false,
                message: 'Invalid response format from LocalAI API',
            };
        }

        const remoteModels = modelsResponse.data.data as Array<{ id?: string }>;

        // 2) Build a set of remote model ids
        const remoteIds = new Set<string>();
        for (const model of remoteModels) {
            if (model?.id) {
                remoteIds.add(String(model.id));
            }
        }

        // 3) Delete models that no longer exist in LocalAI
        const existingDocs = await ModelAiListLocalai.find({ username }).select('modelName');
        const idsToDelete = existingDocs
            .filter((doc) => !remoteIds.has(doc.modelName))
            .map((doc) => doc._id);

        if (idsToDelete.length > 0) {
            await ModelAiListLocalai.deleteMany({ _id: { $in: idsToDelete } });
        }

        // 4) Upsert remote models and update modalities based on detected model type.
        let upsertCount = 0;

        for (const model of remoteModels) {
            if (!model?.id) continue;

            const modelLabel = String(model.id).trim();

            const availableTags = modelTypesByName.get(normalizeText(model.id));
            const modelType: LocalaiModelType = detectLocalaiModelType(model.id, availableTags);
            const modalitySettings = getModalitySettingsByType(modelType);

            await ModelAiListLocalai.findOneAndUpdate(
                { username, modelName: model.id },
                {
                    username,
                    modelLabel,
                    modelName: model.id,
                    modelType,
                    ...modalitySettings,
                    raw: model,
                },
                {
                    upsert: true,
                    new: true,
                }
            );
            upsertCount += 1;
        }

        return {
            success: true,
            message: `LocalAI models synced. ${upsertCount} models upserted, ${idsToDelete.length} removed.`,
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
        }).sort({ modelName: 1 });

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

// Update LocalAI Model (modelType and modalities)
router.patch('/modelLocalaiUpdate', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const {
            _id,
            modelType,
            isInputModalityText,
            isInputModalityImage,
            isInputModalityAudio,
            isInputModalityVideo,
            isOutputModalityText,
            isOutputModalityImage,
            isOutputModalityAudio,
            isOutputModalityVideo,
            isOutputModalityEmbedding,
        } = req.body as {
            _id?: string;
            modelType?: LocalaiModelType;
            isInputModalityText?: 'true' | 'false' | 'pending';
            isInputModalityImage?: 'true' | 'false' | 'pending';
            isInputModalityAudio?: 'true' | 'false' | 'pending';
            isInputModalityVideo?: 'true' | 'false' | 'pending';
            isOutputModalityText?: 'true' | 'false' | 'pending';
            isOutputModalityImage?: 'true' | 'false' | 'pending';
            isOutputModalityAudio?: 'true' | 'false' | 'pending';
            isOutputModalityVideo?: 'true' | 'false' | 'pending';
            isOutputModalityEmbedding?: 'true' | 'false' | 'pending';
        };

        if (!_id || typeof _id !== 'string') {
            return res.status(400).json({ message: 'Model _id is required' });
        }

        const validModelTypes: LocalaiModelType[] = ['', 'llm', 'stt', 'tts', 'embedding', 'image-generation'];
        if (modelType !== undefined && !validModelTypes.includes(modelType)) {
            return res.status(400).json({ message: `modelType must be one of: ${validModelTypes.join(', ')}` });
        }

        const validModalityValues = ['true', 'false', 'pending'] as const;
        const update: Record<string, string> = {};

        if (modelType !== undefined) {
            update.modelType = modelType;
        }
        if (isInputModalityText !== undefined) {
            if (!validModalityValues.includes(isInputModalityText)) {
                return res.status(400).json({ message: 'Invalid value for isInputModalityText' });
            }
            update.isInputModalityText = isInputModalityText;
        }
        if (isInputModalityImage !== undefined) {
            if (!validModalityValues.includes(isInputModalityImage)) {
                return res.status(400).json({ message: 'Invalid value for isInputModalityImage' });
            }
            update.isInputModalityImage = isInputModalityImage;
        }
        if (isInputModalityAudio !== undefined) {
            if (!validModalityValues.includes(isInputModalityAudio)) {
                return res.status(400).json({ message: 'Invalid value for isInputModalityAudio' });
            }
            update.isInputModalityAudio = isInputModalityAudio;
        }
        if (isInputModalityVideo !== undefined) {
            if (!validModalityValues.includes(isInputModalityVideo)) {
                return res.status(400).json({ message: 'Invalid value for isInputModalityVideo' });
            }
            update.isInputModalityVideo = isInputModalityVideo;
        }
        if (isOutputModalityText !== undefined) {
            if (!validModalityValues.includes(isOutputModalityText)) {
                return res.status(400).json({ message: 'Invalid value for isOutputModalityText' });
            }
            update.isOutputModalityText = isOutputModalityText;
        }
        if (isOutputModalityImage !== undefined) {
            if (!validModalityValues.includes(isOutputModalityImage)) {
                return res.status(400).json({ message: 'Invalid value for isOutputModalityImage' });
            }
            update.isOutputModalityImage = isOutputModalityImage;
        }
        if (isOutputModalityAudio !== undefined) {
            if (!validModalityValues.includes(isOutputModalityAudio)) {
                return res.status(400).json({ message: 'Invalid value for isOutputModalityAudio' });
            }
            update.isOutputModalityAudio = isOutputModalityAudio;
        }
        if (isOutputModalityVideo !== undefined) {
            if (!validModalityValues.includes(isOutputModalityVideo)) {
                return res.status(400).json({ message: 'Invalid value for isOutputModalityVideo' });
            }
            update.isOutputModalityVideo = isOutputModalityVideo;
        }
        if (isOutputModalityEmbedding !== undefined) {
            if (!validModalityValues.includes(isOutputModalityEmbedding)) {
                return res.status(400).json({ message: 'Invalid value for isOutputModalityEmbedding' });
            }
            update.isOutputModalityEmbedding = isOutputModalityEmbedding;
        }

        if (Object.keys(update).length === 0) {
            return res.status(400).json({ message: 'No valid fields to update' });
        }

        const updated = await ModelAiListLocalai.findOneAndUpdate(
            { username: res.locals.auth_username, _id },
            { $set: update },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: 'Model not found' });
        }

        return res.json({
            message: 'LocalAI model updated successfully',
            doc: updated,
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