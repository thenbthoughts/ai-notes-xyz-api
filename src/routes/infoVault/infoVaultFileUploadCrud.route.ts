import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelInfoVaultFileUpload } from '../../schema/schemaInfoVault/SchemaInfoVaultFileUpload.schema';

const router = Router();

// Get Info Vault File Upload API
router.post('/infoVaultFileUploadGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const pipelineDocument: PipelineStage[] = [];
        let tempStage: PipelineStage;

        tempStage = {
            $match: {
                username: res.locals.auth_username,
            },
        };
        pipelineDocument.push(tempStage);

        // stage -> match -> infoVaultId
        const arg_infoVaultId = req.body.infoVaultId;
        let infoVaultId = null as mongoose.Types.ObjectId | null;
        infoVaultId = arg_infoVaultId ? mongoose.Types.ObjectId.createFromHexString(arg_infoVaultId) : null;
        if (!infoVaultId) {
            return res.status(400).json({ message: 'Info vault ID cannot be null' });
        }
        tempStage = {
            $match: {
                infoVaultId: infoVaultId,
            }
        };
        pipelineDocument.push(tempStage);

        const docs = await ModelInfoVaultFileUpload.aggregate(pipelineDocument);

        return res.json({
            message: 'Info vault file uploads retrieved successfully',
            count: docs.length,
            docs,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Info Vault File Upload API
router.post('/infoVaultFileUploadAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const newFileUpload = await ModelInfoVaultFileUpload.create({
            fileType: req.body.fileType || '',
            fileUrl: req.body.fileUrl || '',
            fileTitle: req.body.fileTitle || '',
            fileDescription: req.body.fileDescription || '',
            aiTitle: req.body.aiTitle || '',
            aiSummaryContext: req.body.aiSummaryContext || '',
            aiSummarySpecific: req.body.aiSummarySpecific || '',
            aiTags: req.body.aiTags || [],
            username: res.locals.auth_username,
            infoVaultId: req.body.infoVaultId || null,
            createdAtUtc: new Date(),
            createdAtIpAddress: req.ip,
            createdAtUserAgent: req.headers['user-agent'] || '',
        });

        return res.json({
            message: 'Info vault file upload added successfully',
            doc: newFileUpload,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Info Vault File Upload API
router.post('/infoVaultFileUploadDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const _id = req.body._id ? mongoose.Types.ObjectId.createFromHexString(req.body._id) : null;
        if (!_id) {
            return res.status(400).json({ message: 'File upload ID cannot be null' });
        }

        const deletedFileUpload = await ModelInfoVaultFileUpload.findOneAndDelete({
            _id,
            username: res.locals.auth_username,
        });

        if (!deletedFileUpload) {
            return res.status(404).json({ message: 'File upload not found or unauthorized' });
        }

        return res.json({ message: 'Info vault file upload deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;