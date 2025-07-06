import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';

// Router
const router = Router();

// Get Note API
router.post('/notesGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // variable -> threadId
        let threadId = null as mongoose.Types.ObjectId | null;
        const arg_threadId = req.body.threadId;
        if (typeof req.body?.threadId === 'string') {
            threadId = req.body?.threadId ? mongoose.Types.ObjectId.createFromHexString(arg_threadId) : null;
        }
        if (threadId === null) {
            return res.status(400).json({ message: 'Thread ID cannot be null' });
        }

        let tempStage = {} as PipelineStage;
        const stateDocument = [] as PipelineStage[];

        // stateDocument -> match
        tempStage = {
            $match: {
                username: res.locals.auth_username,
                threadId: threadId,
            }
        }
        stateDocument.push(tempStage);

        // stateDocument -> sort
        tempStage = {
            $sort: {
                createdAtUtc: 1,
            }
        }
        stateDocument.push(tempStage);

        // pipeline
        const resultNotes = await ModelChatLlm.aggregate(stateDocument);

        return res.json({
            message: 'Notes retrieved successfully',
            count: resultNotes.length,
            docs: resultNotes,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Note API
router.post('/notesDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
         // variable -> _id
         let _id = null as mongoose.Types.ObjectId | null;
         const arg__id = req.body._id;
         if (typeof req.body?._id === 'string') {
             _id = req.body?._id ? mongoose.Types.ObjectId.createFromHexString(arg__id) : null;
         }
         if (_id === null) {
             return res.status(400).json({ message: 'Thread ID cannot be null' });
         }

        const note = await ModelChatLlm.findOneAndDelete({
            _id: _id,
            username: res.locals.auth_username,
        });
        if (!note) {
            return res.status(404).json({ message: 'Note not found or unauthorized' });
        }
        return res.json({ message: 'Note deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;