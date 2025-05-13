import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { ModelLifeEvents } from '../../../schema/SchemaLifeEvents.schema';
import { ModelLifeEventsFileUpload } from '../../../schema/SchemaLifeEventFileUpload.schema';
import { ILifeEventsFileUpload } from '../../../types/typesSchema/SchemaLifeEventFileUpload.types';

const router = Router();

// Get Life Events File Upload API
router.post('/lifeEventsFileUploadGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let page = 1;
        let perPage = 10;

        if (typeof req.body?.page === 'number' && req.body.page >= 1) {
            page = req.body.page;
        }
        if (typeof req.body?.perPage === 'number' && req.body.perPage >= 1) {
            perPage = req.body.perPage;
        }

        const matchStage: PipelineStage = {
            $match: {
                username: res.locals.auth_username,
            },
        };

        const skipStage: PipelineStage = {
            $skip: (page - 1) * perPage,
        };

        const limitStage: PipelineStage = {
            $limit: perPage,
        };

        const pipeline: PipelineStage[] = [matchStage, skipStage, limitStage];

        const docs = await ModelLifeEventsFileUpload.aggregate(pipeline);
        const totalCount = await ModelLifeEventsFileUpload.countDocuments(matchStage.$match);

        return res.json({
            message: 'Life events file uploads retrieved successfully',
            count: totalCount,
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