import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { ModelNotesWorkspace } from '../../schema/schemaNotes/SchemaNotesWorkspace.schema';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelLlmPendingTaskCron } from '../../schema/SchemaLlmPendingTaskCron.schema';
import { INotes } from '../../types/typesSchema/typesSchemaNotes/SchemaNotes.types';

const router = Router();

// Get Notes API
router.post('/notesGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let tempStage = {} as PipelineStage;
        const pipelineDocument: PipelineStage[] = [];
        const pipelineCount: PipelineStage[] = [];

        // args
        let page = 1;
        let perPage = 1000;

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

        // stage -> match -> openRandomNotes
        if (typeof req.body?.openRandomNotes === 'string') {
            if (req.body.openRandomNotes === 'true') {
                tempStage = {
                    $sample: {
                        size: 1,
                    }
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

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

        // stage -> match -> notesWorkspaceId
        const arg_notesWorkspaceId = req.body.notesWorkspaceId;
        if (typeof arg_notesWorkspaceId === 'string') {
            if (arg_notesWorkspaceId.length === 24) {
                let notesWorkspaceId = null as mongoose.Types.ObjectId | null;
                notesWorkspaceId = arg_notesWorkspaceId ? mongoose.Types.ObjectId.createFromHexString(arg_notesWorkspaceId) : null;
                if (notesWorkspaceId) {
                    if (notesWorkspaceId.toHexString().length === 24) {
                        tempStage = { $match: { notesWorkspaceId: notesWorkspaceId } };
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

        // stage -> sort -> title
        tempStage = {
            $sort: {
                title: 1,
            },
        };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

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

        const notes = await ModelNotes.aggregate(pipelineDocument);
        const notesCount = await ModelNotes.aggregate(pipelineCount);

        let totalCount = 0;
        if (notesCount.length === 1) {
            if (notesCount[0].count) {
                totalCount = notesCount[0].count;
            }
        }

        return res.json({
            message: 'Notes retrieved successfully',
            count: totalCount,
            docs: notes,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Note API
router.post('/notesDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'Note ID cannot be null' });
        }

        const note = await ModelNotes.findOneAndDelete({
            _id: _id,
            username: res.locals.auth_username,
        });

        // TODO delete notes from vector db

        if (!note) {
            return res.status(404).json({ message: 'Note not found or unauthorized' });
        }

        return res.json({ message: 'Note deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add Note API
router.post('/notesAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let title = `Empty Note - ${new Date().toDateString()} ${new Date().toLocaleTimeString().substring(0, 7)}`;

        // stage -> match -> notesWorkspaceId
        let notesWorkspaceId = null as mongoose.Types.ObjectId | null;
        const arg_notesWorkspaceId = req.body.notesWorkspaceId;
        if (typeof arg_notesWorkspaceId === 'string') {
            if (arg_notesWorkspaceId.length === 24) {
                notesWorkspaceId = arg_notesWorkspaceId ? mongoose.Types.ObjectId.createFromHexString(arg_notesWorkspaceId) : null;
            }
        }
        if (notesWorkspaceId === null) {
            return res.status(400).json({ message: 'Notes workspace ID cannot be null' });
        }

        // does workspace belong to user
        const notesWorkspace = await ModelNotesWorkspace.findOne({
            _id: notesWorkspaceId,
            username: res.locals.auth_username,
        });
        if (!notesWorkspace) {
            return res.status(400).json({ message: 'Notes workspace not found or unauthorized' });
        }

        const now = new Date();
        const newNote = await ModelNotes.create({
            username: res.locals.auth_username,
            notesWorkspaceId: notesWorkspaceId,
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
            message: 'Note added successfully',
            doc: newNote,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Edit Note API
router.post('/notesEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'Note ID cannot be null' });
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
            await ModelNotes.updateOne(
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

        // generate ai tags by id
        await ModelLlmPendingTaskCron.create({
            username: res.locals.auth_username,
            taskType: llmPendingTaskTypes.page.notes.generateNoteAiTagsById,
            targetRecordId: _id,
        });

        // generate ai summary by id
        await ModelLlmPendingTaskCron.create({
            username: res.locals.auth_username,
            taskType: llmPendingTaskTypes.page.notes.generateNoteAiSummaryById,
            targetRecordId: _id,
        });

        // generate embedding by id
        await ModelLlmPendingTaskCron.create({
            username: res.locals.auth_username,
            taskType: llmPendingTaskTypes.page.notes.generateEmbeddingByNotesId,
            targetRecordId: _id,
        });

        return res.json({
            message: 'Note edited successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;