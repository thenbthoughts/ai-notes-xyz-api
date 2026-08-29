import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { ModelNotesWorkspace } from '../../schema/schemaNotes/SchemaNotesWorkspace.schema';
import { ModelNotesVersion } from '../../schema/schemaNotes/SchemaNotesVersion.schema';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelLlmPendingTaskCron } from '../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';
import { reindexDocument } from '../../utils/search/reindexGlobalSearch';
import { deleteFilesByParentEntityId } from '../upload/uploadFileS3ForFeatures';

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
                userId: res.locals.auth_userId,
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

        // stage -> match -> folder
        if (typeof req.body?.folder === 'string') {
            if (req.body.folder.length >= 1) {
                tempStage = {
                    $match: { folder: req.body.folder },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> match -> tags
        if (Array.isArray(req.body?.tags)) {
            if (req.body.tags.length >= 1) {
                tempStage = {
                    $match: { tags: { $in: req.body.tags } },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> match -> title
        if (typeof req.body?.title === 'string') {
            if (req.body.title.length >= 1) {
                tempStage = {
                    $match: { title: req.body.title },
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

                // stage -> lookup -> comments
                const lookupMatchCommentsAnd = [];
                for (let iLookup = 0; iLookup < searchQueryArr.length; iLookup++) {
                    const elementStr = searchQueryArr[iLookup];
                    lookupMatchCommentsAnd.push({ commentText: { $regex: elementStr, $options: 'i' } })
                }
                tempStage = {
                    $lookup: {
                        from: 'commentsCommon',
                        let: { noteId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ['$entityId', '$$noteId']
                                    },
                                    $or: [
                                        ...lookupMatchCommentsAnd,
                                    ],
                                }
                            }
                        ],
                        as: 'commentSearch',
                    }
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);

                const matchAnd = [];
                for (let index = 0; index < searchQueryArr.length; index++) {
                    const elementStr = searchQueryArr[index];
                    matchAnd.push({
                        $or: [
                            // notes
                            { title: { $regex: elementStr, $options: 'i' } },
                            { description: { $regex: elementStr, $options: 'i' } },
                            { aiSummary: { $regex: elementStr, $options: 'i' } },
                            { aiTags: { $regex: elementStr, $options: 'i' } },
                            { aiSuggestions: { $regex: elementStr, $options: 'i' } },

                            // comment search
                            { 'commentSearch.commentText': { $regex: elementStr, $options: 'i' } },
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

                // stage -> unset chatListSearch
                tempStage = {
                    $unset: [
                        'commentSearch',
                    ],
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> sort
        const sortParam = typeof req.body?.sort === 'string' ? req.body.sort : '';
        if (sortParam === 'title') {
            tempStage = { $sort: { title: 1 } };
        } else if (sortParam === 'createdAt') {
            tempStage = { $sort: { createdAtUtc: -1 } };
        } else if (sortParam === 'order') {
            tempStage = { $sort: { order: 1, updatedAtUtc: -1 } };
        } else {
            tempStage = {
                $sort: {
                    updatedAtUtc: -1,
                },
            };
        }
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
            userId: res.locals.auth_userId,
        });

        // TODO delete notes from vector db

        if (!note) {
            return res.status(404).json({ message: 'Note not found or unauthorized' });
        }

        // delete files from s3
        await deleteFilesByParentEntityId({
            userId: res.locals.auth_userId,
            parentEntityId: _id.toString(),
        });

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
            userId: res.locals.auth_userId,
        });
        if (!notesWorkspace) {
            return res.status(400).json({ message: 'Notes workspace not found or unauthorized' });
        }

        const now = new Date();
        const maxOrderDoc = await ModelNotes.findOne({ userId: res.locals.auth_userId, notesWorkspaceId: notesWorkspaceId }).sort({ order: -1 }).select('order');
        const nextOrder = maxOrderDoc ? (maxOrderDoc.order + 1) : 0;
        const folderVal = typeof req.body.folder === 'string' ? req.body.folder : '';
        const newNote = await ModelNotes.create({
            userId: res.locals.auth_userId,
            notesWorkspaceId: notesWorkspaceId,
            title: req.body.title || title,
            description: req.body.description || '',
            isStar: req.body.isStar === true,
            tags: Array.isArray(req.body.tags) ? req.body.tags : [],
            folder: folderVal,
            order: typeof req.body.order === 'number' ? req.body.order : nextOrder,
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

        // generate Feature AI Actions by source id
        await ModelLlmPendingTaskCron.create({
            userId: res.locals.auth_userId,
            taskType: llmPendingTaskTypes.page.featureAiActions.notes,
            targetRecordId: newNote._id,
        });

        // reindex for global search
        await reindexDocument({
            reindexDocumentArr: [{
                collectionName: 'notes',
                documentId: (newNote._id as mongoose.Types.ObjectId).toString(),
            }],
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

        const existing = await ModelNotes.findOne({ _id: _id, userId: res.locals.auth_userId });
        if (!existing) {
            return res.status(404).json({ message: 'Note not found' });
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
        if (typeof req.body.folder === 'string') {
            updateObj.folder = req.body.folder;
        }
        if (typeof req.body.order === 'number') {
            updateObj.order = req.body.order;
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
        if (typeof req.body.notesWorkspaceId === 'string') {
            const notesWorkspaceId = getMongodbObjectOrNull(req.body.notesWorkspaceId);
            if (notesWorkspaceId) {
                if (notesWorkspaceId.toHexString().length === 24) {
                    updateObj.notesWorkspaceId = notesWorkspaceId;
                }
            }
        }
        updateObj.updatedAtUtc = new Date();
        updateObj.updatedAtIpAddress = req.ip || '';
        updateObj.updatedAtUserAgent = req.headers['user-agent'] || '';

        if (Object.keys(updateObj).length >= 1) {
            await ModelNotes.updateOne(
                {
                    _id: _id,
                    userId: res.locals.auth_userId,
                },
                {
                    $set: {
                        ...updateObj,
                    }
                }
            );
            try {
                await ModelNotesVersion.create({
                    userId: res.locals.auth_userId,
                    noteId: _id,
                    title: existing.title,
                    description: existing.description,
                    tags: existing.tags,
                    folder: (existing as any).folder || '',
                    createdAtUtc: new Date(),
                });
                const count = await ModelNotesVersion.countDocuments({ noteId: _id });
                if (count > 20) {
                    const oldest = await ModelNotesVersion.find({ noteId: _id }).sort({ createdAtUtc: 1 }).limit(count - 20);
                    const ids = oldest.map((d) => d._id);
                    await ModelNotesVersion.deleteMany({ _id: { $in: ids } });
                }
            } catch (e) {
                console.error(e);
            }
        }

        // generate Feature AI Actions by source id
        await ModelLlmPendingTaskCron.create({
            userId: res.locals.auth_userId,
            taskType: llmPendingTaskTypes.page.featureAiActions.notes,
            targetRecordId: _id,
        });

        // reindex for global search
        await reindexDocument({
            reindexDocumentArr: [{
                collectionName: 'notes',
                documentId: _id.toString(),
            }],
        });

        return res.json({
            message: 'Note edited successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/notesBulkMove', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const noteIds: string[] = Array.isArray(req.body.noteIds) ? req.body.noteIds : [];
        const targetWorkspaceIdStr = typeof req.body.targetWorkspaceId === 'string' ? req.body.targetWorkspaceId : '';
        const targetFolder = typeof req.body.targetFolder === 'string' ? req.body.targetFolder : null;
        if (noteIds.length === 0) {
            return res.status(400).json({ message: 'noteIds required' });
        }
        const objectIds: mongoose.Types.ObjectId[] = [];
        for (let i = 0; i < noteIds.length; i++) {
            const oid = getMongodbObjectOrNull(noteIds[i]);
            if (oid) {
                objectIds.push(oid);
            }
        }
        if (objectIds.length === 0) {
            return res.status(400).json({ message: 'invalid noteIds' });
        }
        const update: any = { updatedAtUtc: new Date() };
        if (targetWorkspaceIdStr.length === 24) {
            const wsId = getMongodbObjectOrNull(targetWorkspaceIdStr);
            if (wsId) {
                const ws = await ModelNotesWorkspace.findOne({ _id: wsId, userId: res.locals.auth_userId });
                if (!ws) {
                    return res.status(400).json({ message: 'target workspace not found' });
                }
                update.notesWorkspaceId = wsId;
            }
        }
        if (targetFolder !== null) {
            update.folder = targetFolder;
        }
        if (typeof req.body.orderMap === 'object' && req.body.orderMap !== null) {
            const orderMap = req.body.orderMap as Record<string, number>;
            for (let i = 0; i < noteIds.length; i++) {
                const nid = noteIds[i];
                const oid = getMongodbObjectOrNull(nid);
                if (oid) {
                    const ord = orderMap[nid];
                    const singleUpdate: any = { ...update };
                    if (typeof ord === 'number') {
                        singleUpdate.order = ord;
                    }
                    await ModelNotes.updateOne({ _id: oid, userId: res.locals.auth_userId }, { $set: singleUpdate });
                }
            }
            return res.json({ message: 'Bulk move completed' });
        }
        await ModelNotes.updateMany({ _id: { $in: objectIds }, userId: res.locals.auth_userId }, { $set: update });
        return res.json({ message: 'Bulk move completed', modified: objectIds.length });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/notesVersions', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const noteIdStr = typeof req.body.noteId === 'string' ? req.body.noteId : (typeof req.query.noteId === 'string' ? req.query.noteId : '');
        if (!noteIdStr || noteIdStr.length !== 24) {
            return res.status(400).json({ message: 'noteId required' });
        }
        const noteId = getMongodbObjectOrNull(noteIdStr);
        if (!noteId) {
            return res.status(400).json({ message: 'invalid noteId' });
        }
        const note = await ModelNotes.findOne({ _id: noteId, userId: res.locals.auth_userId });
        if (!note) {
            return res.status(404).json({ message: 'Note not found' });
        }
        const docs = await ModelNotesVersion.find({ noteId: noteId, userId: res.locals.auth_userId }).sort({ createdAtUtc: -1 }).limit(20);
        return res.json({ message: 'Versions retrieved', docs });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/notesVersions', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const noteIdStr = typeof req.query.noteId === 'string' ? req.query.noteId : '';
        if (!noteIdStr || noteIdStr.length !== 24) {
            return res.status(400).json({ message: 'noteId required' });
        }
        const noteId = getMongodbObjectOrNull(noteIdStr);
        if (!noteId) {
            return res.status(400).json({ message: 'invalid noteId' });
        }
        const note = await ModelNotes.findOne({ _id: noteId, userId: res.locals.auth_userId });
        if (!note) {
            return res.status(404).json({ message: 'Note not found' });
        }
        const docs = await ModelNotesVersion.find({ noteId: noteId, userId: res.locals.auth_userId }).sort({ createdAtUtc: -1 }).limit(20);
        return res.json({ message: 'Versions retrieved', docs });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;
