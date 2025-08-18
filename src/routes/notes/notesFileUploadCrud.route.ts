import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelNotesFileUpload } from '../../schema/schemaNotes/SchemaNotesFileUpload.schema';

const router = Router();

// Get Notes File Upload API
router.post('/notesFileUploadGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const pipelineDocument: PipelineStage[] = [];
        let tempStage: PipelineStage;

        tempStage = {
            $match: {
                username: res.locals.auth_username,
            },
        };
        pipelineDocument.push(tempStage);

        // stage -> match -> noteId
        const arg_noteId = req.body.noteId;
        let noteId = null as mongoose.Types.ObjectId | null;
        noteId = arg_noteId ? mongoose.Types.ObjectId.createFromHexString(arg_noteId) : null;
        if (!noteId) {
            return res.status(400).json({ message: 'Note ID cannot be null' });
        }
        tempStage = {
            $match: {
                noteId: noteId,
            }
        };
        pipelineDocument.push(tempStage);

        const docs = await ModelNotesFileUpload.aggregate(pipelineDocument);

        return res.json({
            message: 'Notes file uploads retrieved successfully',
            count: docs.length,
            docs,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Notes File Upload API
router.post('/notesFileUploadAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const newFileUpload = await ModelNotesFileUpload.create({
            fileType: req.body.fileType || '',
            fileUrl: req.body.fileUrl || '',
            fileTitle: req.body.fileTitle || '',
            fileDescription: req.body.fileDescription || '',
            aiTitle: req.body.aiTitle || '',
            aiSummaryContext: req.body.aiSummaryContext || '',
            aiSummarySpecific: req.body.aiSummarySpecific || '',
            aiTags: req.body.aiTags || [],
            username: res.locals.auth_username,
            noteId: req.body.noteId || null,
            createdAtUtc: new Date(),
            createdAtIpAddress: req.ip,
            createdAtUserAgent: req.headers['user-agent'] || '',
        });

        return res.json({
            message: 'Notes file upload added successfully',
            doc: newFileUpload,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Notes File Upload API
router.post('/notesFileUploadDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const _id = req.body._id ? mongoose.Types.ObjectId.createFromHexString(req.body._id) : null;
        if (!_id) {
            return res.status(400).json({ message: 'File upload ID cannot be null' });
        }

        const deletedFileUpload = await ModelNotesFileUpload.findOneAndDelete({
            _id,
            username: res.locals.auth_username,
        });

        if (!deletedFileUpload) {
            return res.status(404).json({ message: 'File upload not found or unauthorized' });
        }

        return res.json({ message: 'Notes file upload deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;