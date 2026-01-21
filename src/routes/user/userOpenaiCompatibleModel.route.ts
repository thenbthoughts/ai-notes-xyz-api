import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelOpenaiCompatibleModel } from '../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema';

const router = Router();

// Get OpenAI Compatible Model Configurations API
router.post('/openaiCompatibleModelGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let tempStage = {} as PipelineStage;
        const pipelineDocument: PipelineStage[] = [];
        const pipelineCount: PipelineStage[] = [];

        // args
        let page = 1;
        let perPage = 100;

        // set arg -> page
        if (typeof req.body?.page === 'number') {
            if (req.body.page >= 1) {
                page = req.body.page;
            }
        }
        // set arg -> perPage
        if (typeof req.body?.perPage === 'number') {
            if (req.body.perPage >= 1) {
                perPage = req.body.perPage;
            }
        }

        // stage -> match -> auth
        tempStage = {
            $match: {
                username: res.locals.auth_username,
            }
        };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // stage -> match -> recordId
        const arg_recordId = req.body.recordId;
        if (typeof arg_recordId === 'string') {
            if (arg_recordId.length === 24) {
                let _id = null as mongoose.Types.ObjectId | null;
                _id = arg_recordId ? mongoose.Types.ObjectId.createFromHexString(arg_recordId) : null;
                if (_id) {
                    if (_id.toHexString().length === 24) {
                        tempStage = {
                            $match: {
                                _id: _id,
                            }
                        };
                        pipelineDocument.push(tempStage);
                        pipelineCount.push(tempStage);
                    }
                }
            }
        }

        // stage -> sort -> createdAtUtc (newest first)
        tempStage = {
            $sort: {
                createdAtUtc: -1,
            },
        };
        pipelineDocument.push(tempStage);

        // stage -> skip
        tempStage = {
            $skip: (page - 1) * perPage,
        };
        pipelineDocument.push(tempStage);

        // stage -> limit
        tempStage = {
            $limit: perPage,
        };
        pipelineDocument.push(tempStage);

        // stage -> project -> exclude apiKey
        tempStage = {
            $project: {
                apiKey: 0, // Exclude apiKey from response
            }
        };
        pipelineDocument.push(tempStage);

        // stageCount -> count
        pipelineCount.push({
            $count: 'count'
        });

        const configs = await ModelOpenaiCompatibleModel.aggregate(pipelineDocument);
        const configsCount = await ModelOpenaiCompatibleModel.aggregate(pipelineCount);

        let totalCount = 0;
        if (configsCount.length === 1) {
            if (configsCount[0].count) {
                totalCount = configsCount[0].count;
            }
        }

        return res.json({
            message: 'OpenAI Compatible Model configurations retrieved successfully',
            count: totalCount,
            docs: configs,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error', error: String(error) });
    }
});

// Add OpenAI Compatible Model Configuration API
router.post('/openaiCompatibleModelAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const now = new Date();

        // Validate required fields
        if (typeof req.body.baseUrl !== 'string' || !req.body.baseUrl.trim()) {
            return res.status(400).json({ message: 'Base URL is required', error: 'Base URL cannot be empty' });
        }

        if (typeof req.body.apiKey !== 'string' || !req.body.apiKey.trim()) {
            return res.status(400).json({ message: 'API Key is required', error: 'API Key cannot be empty' });
        }

        // Validate custom headers JSON if provided
        if (req.body.customHeaders && typeof req.body.customHeaders === 'string') {
            try {
                JSON.parse(req.body.customHeaders);
            } catch (e) {
                return res.status(400).json({ message: 'Custom Headers must be valid JSON', error: String(e) });
            }
        }

        // Validate and set modality fields (default to 'true' for text, 'false' for others)
        const isInputModalityText = req.body.isInputModalityText === 'true' ? 'true' : 'false';
        const isInputModalityImage = req.body.isInputModalityImage === 'true' ? 'true' : 'false';
        const isInputModalityAudio = req.body.isInputModalityAudio === 'true' ? 'true' : 'false';
        const isInputModalityVideo = req.body.isInputModalityVideo === 'true' ? 'true' : 'false';
        const isOutputModalityText = req.body.isOutputModalityText === 'true' ? 'true' : 'false';
        const isOutputModalityImage = req.body.isOutputModalityImage === 'true' ? 'true' : 'false';
        const isOutputModalityAudio = req.body.isOutputModalityAudio === 'true' ? 'true' : 'false';
        const isOutputModalityVideo = req.body.isOutputModalityVideo === 'true' ? 'true' : 'false';

        const newConfig = await ModelOpenaiCompatibleModel.create({
            username: res.locals.auth_username,
            providerName: req.body.providerName || '',
            baseUrl: req.body.baseUrl.trim(),
            apiKey: req.body.apiKey.trim(),
            modelName: req.body.modelName || '',
            customHeaders: req.body.customHeaders || '',
            isInputModalityText,
            isInputModalityImage,
            isInputModalityAudio,
            isInputModalityVideo,
            isOutputModalityText,
            isOutputModalityImage,
            isOutputModalityAudio,
            isOutputModalityVideo,
            createdAtUtc: now,
            updatedAtUtc: now,
        });

        return res.json({
            message: 'OpenAI Compatible Model configuration added successfully',
            doc: newConfig,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error', error: String(error) });
    }
});

// Edit OpenAI Compatible Model Configuration API
router.post('/openaiCompatibleModelEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'Configuration ID cannot be null', error: 'Invalid ID' });
        }

        const updateObj = {} as any;

        if (typeof req.body.providerName === 'string') {
            updateObj.providerName = req.body.providerName.trim() || '';
        }

        if (typeof req.body.modelName === 'string') {
            updateObj.modelName = req.body.modelName.trim() || '';
        }

        if (typeof req.body.baseUrl === 'string') {
            if (!req.body.baseUrl.trim()) {
                return res.status(400).json({ message: 'Base URL cannot be empty', error: 'Base URL is required' });
            }
            updateObj.baseUrl = req.body.baseUrl.trim();
        }

        // Only update apiKey if it's provided (for edit, apiKey is optional - only update if user wants to change it)
        if (typeof req.body.apiKey === 'string' && req.body.apiKey.trim()) {
            updateObj.apiKey = req.body.apiKey.trim();
        }

        if (typeof req.body.customHeaders === 'string') {
            if (req.body.customHeaders.trim()) {
                try {
                    JSON.parse(req.body.customHeaders);
                    updateObj.customHeaders = req.body.customHeaders.trim();
                } catch (e) {
                    return res.status(400).json({ message: 'Custom Headers must be valid JSON', error: String(e) });
                }
            } else {
                updateObj.customHeaders = '';
            }
        }

        // Update modality fields if provided
        if (req.body.isInputModalityText !== undefined) {
            updateObj.isInputModalityText = req.body.isInputModalityText === 'true' ? 'true' : 'false';
        }
        if (req.body.isInputModalityImage !== undefined) {
            updateObj.isInputModalityImage = req.body.isInputModalityImage === 'true' ? 'true' : 'false';
        }
        if (req.body.isInputModalityAudio !== undefined) {
            updateObj.isInputModalityAudio = req.body.isInputModalityAudio === 'true' ? 'true' : 'false';
        }
        if (req.body.isInputModalityVideo !== undefined) {
            updateObj.isInputModalityVideo = req.body.isInputModalityVideo === 'true' ? 'true' : 'false';
        }
        if (req.body.isOutputModalityText !== undefined) {
            updateObj.isOutputModalityText = req.body.isOutputModalityText === 'true' ? 'true' : 'false';
        }
        if (req.body.isOutputModalityImage !== undefined) {
            updateObj.isOutputModalityImage = req.body.isOutputModalityImage === 'true' ? 'true' : 'false';
        }
        if (req.body.isOutputModalityAudio !== undefined) {
            updateObj.isOutputModalityAudio = req.body.isOutputModalityAudio === 'true' ? 'true' : 'false';
        }
        if (req.body.isOutputModalityVideo !== undefined) {
            updateObj.isOutputModalityVideo = req.body.isOutputModalityVideo === 'true' ? 'true' : 'false';
        }

        updateObj.updatedAtUtc = new Date();

        if (Object.keys(updateObj).length >= 1) {
            const result = await ModelOpenaiCompatibleModel.updateOne(
                {
                    _id: _id,
                    username: res.locals.auth_username,
                },
                {
                    $set: {
                        ...updateObj,
                    }
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ message: 'Configuration not found or unauthorized', error: 'Not found' });
            }
        }

        return res.json({
            message: 'OpenAI Compatible Model configuration edited successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error', error: String(error) });
    }
});

// Delete OpenAI Compatible Model Configuration API
router.post('/openaiCompatibleModelDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'Configuration ID cannot be null', error: 'Invalid ID' });
        }

        const config = await ModelOpenaiCompatibleModel.findOneAndDelete({
            _id: _id,
            username: res.locals.auth_username,
        });

        if (!config) {
            return res.status(404).json({ message: 'Configuration not found or unauthorized', error: 'Not found' });
        }

        return res.json({ message: 'OpenAI Compatible Model configuration deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error', error: String(error) });
    }
});

export default router;
