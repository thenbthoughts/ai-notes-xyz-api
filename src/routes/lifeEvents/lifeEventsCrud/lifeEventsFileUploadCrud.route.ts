import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { ModelLifeEventsFileUpload } from '../../../schema/SchemaLifeEventFileUpload.schema';

const router = Router();

// Get Life Events File Upload API
router.post('/lifeEventsFileUploadGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const pipelineDocument: PipelineStage[] = [];
        let tempStage: PipelineStage;

        tempStage = {
            $match: {
                username: res.locals.auth_username,
            },
        };
        pipelineDocument.push(tempStage);

        // stage -> match -> lifeEventId
        const arg_lifeEventId = req.body.lifeEventId;
        let lifeEventId = null as mongoose.Types.ObjectId | null;
        lifeEventId = arg_lifeEventId ? mongoose.Types.ObjectId.createFromHexString(arg_lifeEventId) : null;
        if (!lifeEventId) {
            return res.status(400).json({ message: 'Life event ID cannot be null' });
        }
        tempStage = {
            $match: {
                lifeEventId: lifeEventId,
            }
        };
        pipelineDocument.push(tempStage);

        const docs = await ModelLifeEventsFileUpload.aggregate(pipelineDocument);

        return res.json({
            message: 'Life events file uploads retrieved successfully',
            count: docs.length,
            docs,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Life Events File Upload API
router.post('/lifeEventsFileUploadAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const newFileUpload = await ModelLifeEventsFileUpload.create({
            fileType: req.body.fileType || '',
            fileUrl: req.body.fileUrl || '',
            fileTitle: req.body.fileTitle || '',
            fileDescription: req.body.fileDescription || '',
            aiTitle: req.body.aiTitle || '',
            aiSummaryContext: req.body.aiSummaryContext || '',
            aiSummarySpecific: req.body.aiSummarySpecific || '',
            aiTags: req.body.aiTags || [],
            username: res.locals.auth_username,
            lifeEventId: req.body.lifeEventId || null,
            createdAtUtc: new Date(),
            createdAtIpAddress: req.ip,
            createdAtUserAgent: req.headers['user-agent'] || '',
        });

        return res.json({
            message: 'Life events file upload added successfully',
            doc: newFileUpload,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Life Events File Upload API
router.post('/lifeEventsFileUploadDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const _id = req.body._id ? mongoose.Types.ObjectId.createFromHexString(req.body._id) : null;
        if (!_id) {
            return res.status(400).json({ message: 'File upload ID cannot be null' });
        }

        const deletedFileUpload = await ModelLifeEventsFileUpload.findOneAndDelete({
            _id,
            username: res.locals.auth_username,
        });

        if (!deletedFileUpload) {
            return res.status(404).json({ message: 'File upload not found or unauthorized' });
        }

        return res.json({ message: 'Life events file upload deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;