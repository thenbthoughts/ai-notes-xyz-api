import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelNotesWorkspace } from '../../schema/schemaNotes/SchemaNotesWorkspace.schema';

const router = Router();

// Get Notes Workspace API
router.post('/notesWorkspaceGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let tempStage = {} as PipelineStage;
        const pipelineDocument: PipelineStage[] = [];
        const pipelineCount: PipelineStage[] = [];

        // args
        let page = 1;
        let perPage = 10;

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

        // stage -> match -> isStar
        if (typeof req.body?.isStar === 'string') {
            if (
                req.body?.isStar === 'true' ||
                req.body?.isStar === 'false'
            ) {
                const isStar = req.body?.isStar === 'true';
                tempStage = {
                    $match: {
                        isStar: isStar,
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> search
        if (typeof req.body?.search === 'string') {
            if (req.body.search.length >= 1) {
                let searchQuery = req.body.search as string;

                let searchQueryArr = searchQuery
                    .replace('-', ' ')
                    .split(' ');

                const matchAnd = [];
                for (let index = 0; index < searchQueryArr.length; index++) {
                    const elementStr = searchQueryArr[index];
                    matchAnd.push({
                        $or: [
                            { title: { $regex: elementStr, $options: 'i' } },
                            { description: { $regex: elementStr, $options: 'i' } },
                            { aiSummary: { $regex: elementStr, $options: 'i' } },
                            { aiTags: { $regex: elementStr, $options: 'i' } },
                            { aiSuggestions: { $regex: elementStr, $options: 'i' } },
                        ]
                    })
                }

                tempStage = {
                    $match: {
                        $and: [
                            ...matchAnd,
                        ],
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

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

        // stageCount -> count
        pipelineCount.push({
            $count: 'count'
        });

        const notesWorkspace = await ModelNotesWorkspace.aggregate(pipelineDocument);
        const notesWorkspaceCount = await ModelNotesWorkspace.aggregate(pipelineCount);

        let totalCount = 0;
        if (notesWorkspaceCount.length === 1) {
            if (notesWorkspaceCount[0].count) {
                totalCount = notesWorkspaceCount[0].count;
            }
        }

        return res.json({
            message: 'Notes Workspace retrieved successfully',
            count: totalCount,
            docs: notesWorkspace,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Note Workspace API
router.post('/notesWorkspaceDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'Note ID cannot be null' });
        }

        const noteWorkspace = await ModelNotesWorkspace.findOneAndDelete({
            _id: _id,
            username: res.locals.auth_username,
        });

        if (!noteWorkspace) {
            return res.status(404).json({ message: 'Note Workspace not found or unauthorized' });
        }

        return res.json({ message: 'Note Workspace deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Note Workspace API
router.post('/notesWorkspaceAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let title = `Empty Note - ${new Date().toDateString()} ${new Date().toLocaleTimeString().substring(0, 7)}`;

        const now = new Date();
        const newNoteWorkspace = await ModelNotesWorkspace.create({
            username: res.locals.auth_username,
            title: title,
            description: req.body.description || '',
            isStar: req.body.isStar === true,
            tags: Array.isArray(req.body.tags) ? req.body.tags : [],
            aiSummary: req.body.aiSummary || '',
            aiTags: Array.isArray(req.body.aiTags) ? req.body.aiTags : [],
            aiSuggestions: req.body.aiSuggestions || '',
            createdAtUtc: now,
            createdAtIpAddress: req.ip || '',
            createdAtUserAgent: req.headers['user-agent'] || '',
            updatedAtUtc: now,
            updatedAtIpAddress: req.ip || '',
            updatedAtUserAgent: req.headers['user-agent'] || '',
        });

        return res.json({
            message: 'Note Workspace added successfully',
            doc: newNoteWorkspace,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Edit Note Workspace API
router.post('/notesWorkspaceEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'Note Workspace ID cannot be null' });
        }

        const updateObj = {} as any;
        if (typeof req.body.title === 'string') {
            updateObj.title = req.body.title;
        }
        if (typeof req.body.description === 'string') {
            updateObj.description = req.body.description;
        }
        if (typeof req.body.isStar === 'boolean') {
            updateObj.isStar = req.body.isStar;
        }
        if (Array.isArray(req.body.tags)) {
            updateObj.tags = req.body.tags;
        }
        if (typeof req.body.aiSummary === 'string') {
            updateObj.aiSummary = req.body.aiSummary;
        }
        if (Array.isArray(req.body.aiTags)) {
            updateObj.aiTags = req.body.aiTags;
        }
        if (typeof req.body.aiSuggestions === 'string') {
            updateObj.aiSuggestions = req.body.aiSuggestions;
        }
        updateObj.updatedAtUtc = new Date();
        updateObj.updatedAtIpAddress = req.ip || '';
        updateObj.updatedAtUserAgent = req.headers['user-agent'] || '';

        if (Object.keys(updateObj).length >= 1) {
            await ModelNotesWorkspace.updateOne(
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
        }

        return res.json({
            message: 'Note Workspace edited successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add default notes workspace if not exist
router.post('/notesWorkspaceAddDefault', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const defaultNotesWorkspace = await ModelNotesWorkspace.find({
            username: res.locals.auth_username,
        });

        if (defaultNotesWorkspace.length >= 1) {
            return res.json({
                message: 'Default notes workspace already exists',
            });
        }

        const newNotesWorkspace = await ModelNotesWorkspace.create({
            username: res.locals.auth_username,
            title: 'Your Notes Workspace',
        });
        return res.json({
            message: 'Default notes workspace added successfully',
            doc: newNotesWorkspace,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;