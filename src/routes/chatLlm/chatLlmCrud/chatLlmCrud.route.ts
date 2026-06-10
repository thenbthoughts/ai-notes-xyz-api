import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';
import fileUpload from 'express-fileupload';
import axios from 'axios';

import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAnswerMachineFileV4 } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineFileV4.schema';
import { ModelAnswerMachineRequestV4 } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV4.schema';
import { ModelUserApiKey } from '../../../schema/schemaUser/SchemaUserApiKey.schema';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { deleteFileByPath } from '../../upload/uploadFileS3ForFeatures';
import { mergeAnswerMachineV4StreamIntoNotes } from './utils/mergeAnswerMachineV4StreamIntoNotes';
import type { S3Config } from '../../../utils/upload/uploadFunc';
import { getApiKeyByObject, type tsUserApiKey } from '../../../utils/llm/llmCommonFunc';
import { buildAm4ShellRelativePath, uploadBufferToShellEngine } from './answerMachineV4/am4ShellFileUpload';
import { getAm4ShellUploadConfig } from './answerMachineV4/am4ShellAndOpencodeConfig';

// Router
const router = Router();

const answerMachineV4FileUploadMw = fileUpload({
    limits: { fileSize: 45 * 1024 * 1024 },
    abortOnLimit: true,
});

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

        // Pagination parameters
        const minLimitPerRequest = 10;
        let limit = 50; // Default limit
        let skip = 0; // Default skip (0 means most recent messages)

        if (typeof req.body?.limit === 'number' && req.body.limit > 0) {
            limit = Math.max(req.body.limit, minLimitPerRequest);
        }

        if (typeof req.body?.skip === 'number' && req.body.skip >= 0) {
            skip = req.body.skip;
        }

        let tempStage = {} as PipelineStage;
        const stateDocument = [] as PipelineStage[];
        const stateCount = [] as PipelineStage[];

        // stateDocument -> match
        tempStage = {
            $match: {
                userId: res.locals.auth_userId,
                threadId: threadId,
            }
        }
        stateDocument.push(tempStage);
        stateCount.push(tempStage);

        // stateDocument -> sort (most recent first for pagination)
        tempStage = {
            $sort: {
                createdAtUtc: -1,
            }
        }
        stateDocument.push(tempStage);
        stateCount.push(tempStage);

        // stateDocument -> skip (for pagination)
        if (skip > 0) {
            tempStage = {
                $skip: skip,
            };
            stateDocument.push(tempStage);
        }

        // stateDocument -> limit
        tempStage = {
            $limit: limit,
        };
        stateDocument.push(tempStage);

        // stateCount -> count total messages
        stateCount.push({
            $count: 'count'
        });

        // pipeline
        const resultNotes = await ModelChatLlm.aggregate(stateDocument);
        const resultCount = await ModelChatLlm.aggregate(stateCount);

        let totalCount = 0;
        if (resultCount.length === 1 && resultCount[0].count) {
            totalCount = resultCount[0].count;
        }

        // Reverse the results to maintain chronological order (oldest first)
        resultNotes.reverse();

        const docsWithAm4 = await mergeAnswerMachineV4StreamIntoNotes({
            userId: res.locals.auth_userId,
            threadId,
            chatDocs: resultNotes as Record<string, unknown>[],
        });

        return res.json({
            message: 'Notes retrieved successfully',
            count: docsWithAm4.length,
            totalCount: totalCount,
            docs: docsWithAm4,
            hasMore: (skip + limit) < totalCount,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

/**
 * AM4: stream multipart to Shell Engine `POST /api/shell-engine/file/write` only.
 * Fields: `file`, `threadId`, optional `answerMachineRequestV4Id` (omit for pre-send uploads linked at initiate).
 */
router.post(
    '/answerMachineFileV4Upload',
    middlewareUserAuth,
    answerMachineV4FileUploadMw,
    async (req: Request, res: Response) => {
        try {
            const userId = res.locals.auth_userId;
            const userKeyDoc = await ModelUserApiKey.findOne({ userId });
            const apiKey = getApiKeyByObject(userKeyDoc);
            const shellCfg = getAm4ShellUploadConfig(apiKey as tsUserApiKey);
            if (!shellCfg) {
                return res.status(503).json({ message: 'Shell Engine URL/token not configured for AM4 uploads' });
            }

            if (!req.files || typeof req.files !== 'object' || !req.files.file) {
                return res.status(400).json({ message: 'Missing file (field name: file)' });
            }
            const raw = req.files.file;
            const file = Array.isArray(raw) ? raw[0] : raw;
            if (!file || !file.data || !file.name) {
                return res.status(400).json({ message: 'Invalid upload' });
            }

            const { threadId: tid, answerMachineRequestV4Id: ridOpt } = req.body as Record<string, string | undefined>;
            if (typeof tid !== 'string' || !mongoose.Types.ObjectId.isValid(tid)) {
                return res.status(400).json({ message: 'Invalid threadId' });
            }

            const threadObjectId = mongoose.Types.ObjectId.createFromHexString(tid);
            const threadOk = await ModelChatLlmThread.findOne({
                _id: threadObjectId,
                userId,
            })
                .select('_id answerEngine')
                .lean();
            if (!threadOk) {
                return res.status(404).json({ message: 'Thread not found' });
            }
            if (threadOk.answerEngine !== 'answerMachine4') {
                return res.status(400).json({ message: 'Thread must use Answer Machine 4 for this upload' });
            }

            let requestObjectId: mongoose.Types.ObjectId | null = null;
            if (typeof ridOpt === 'string' && ridOpt.trim() !== '') {
                if (!mongoose.Types.ObjectId.isValid(ridOpt)) {
                    return res.status(400).json({ message: 'Invalid answerMachineRequestV4Id' });
                }
                requestObjectId = mongoose.Types.ObjectId.createFromHexString(ridOpt);
                const reqOk = await ModelAnswerMachineRequestV4.findOne({
                    _id: requestObjectId,
                    threadId: threadObjectId,
                    userId,
                })
                    .select('_id')
                    .lean();
                if (!reqOk) {
                    return res.status(404).json({ message: 'Answer Machine V4 request not found for this thread' });
                }
            }

            const requestIdSegment = requestObjectId ? String(requestObjectId) : 'pending';

            const created = await ModelAnswerMachineFileV4.create({
                answerMachineRequestV4Id: requestObjectId ?? undefined,
                threadId: threadObjectId,
                userId,
                fileName: file.name.slice(0, 500),
                originalSize: file.data.length,
                mimeType: (file.mimetype || 'application/octet-stream').slice(0, 200),
                containerPath: '',
                shellRelativePath: '',
                uploadStatus: 'uploading',
                fileRole: 'user_attachment',
                storedFileUrl: '',
            });

            const relativePath = buildAm4ShellRelativePath({
                userId,
                threadId: tid,
                requestId: requestIdSegment,
                originalFileName: file.name,
            });

            const up = await uploadBufferToShellEngine({
                baseUrl: shellCfg.baseUrl,
                token: shellCfg.token,
                relativePath,
                buffer: file.data,
                fileName: file.name,
                mimeType: file.mimetype || 'application/octet-stream',
                timeoutMs: 120_000,
            });

            if (!up.ok) {
                await ModelAnswerMachineFileV4.findByIdAndUpdate(created._id, {
                    $set: { uploadStatus: 'failed' },
                });
                return res.status(502).json({ message: up.error || 'Shell Engine upload failed' });
            }

            await ModelAnswerMachineFileV4.findByIdAndUpdate(created._id, {
                $set: {
                    uploadStatus: 'saved_to_shell',
                    containerPath: up.absolutePath,
                    shellRelativePath: up.relativePath,
                    originalSize: up.size,
                },
            });

            if (requestObjectId) {
                await ModelAnswerMachineRequestV4.findByIdAndUpdate(requestObjectId, {
                    $addToSet: { attachedFiles: created._id },
                    $set: { updatedAt: new Date() },
                });
            }

            return res.status(201).json({
                message: 'File saved to Shell workspace for Answer Machine 4',
                id: String(created._id),
                containerPath: up.absolutePath,
                shellRelativePath: up.relativePath,
                uploadStatus: 'saved_to_shell',
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    },
);

/** Authenticated proxy: download an AM4 file from Shell via `shellRelativePath`. */
router.post('/answerMachineFileV4Download', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const userKeyDoc = await ModelUserApiKey.findOne({ userId });
        const apiKey = getApiKeyByObject(userKeyDoc);
        const shellCfg = getAm4ShellUploadConfig(apiKey as tsUserApiKey);
        if (!shellCfg) {
            return res.status(503).json({ message: 'Shell Engine URL/token not configured' });
        }

        const fileDocId = typeof req.body?.fileDocId === 'string' ? req.body.fileDocId : '';
        const threadBody = typeof req.body?.threadId === 'string' ? req.body.threadId : '';
        if (!mongoose.Types.ObjectId.isValid(fileDocId)) {
            return res.status(400).json({ message: 'Invalid fileDocId' });
        }
        if (!mongoose.Types.ObjectId.isValid(threadBody)) {
            return res.status(400).json({ message: 'Invalid threadId' });
        }

        const f = await ModelAnswerMachineFileV4.findOne({
            _id: mongoose.Types.ObjectId.createFromHexString(fileDocId),
            threadId: mongoose.Types.ObjectId.createFromHexString(threadBody),
            userId,
        }).lean();

        if (!f) {
            return res.status(404).json({ message: 'File not found' });
        }
        const rel = (f.shellRelativePath || '').trim();
        if (!rel || rel.includes('..')) {
            return res.status(400).json({ message: 'File has no valid shell path' });
        }

        const fileRes = await axios.get(
            `${shellCfg.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/read`,
            {
                params: { relativePath: rel },
                responseType: 'arraybuffer',
                timeout: 120_000,
                headers: { 'X-API-Token': shellCfg.token },
                validateStatus: () => true,
            },
        );

        if (fileRes.status !== 200 || !fileRes.data) {
            return res.status(502).json({ message: `Shell file read failed (HTTP ${fileRes.status})` });
        }

        const buf = Buffer.from(fileRes.data as ArrayBuffer);
        const ct =
            (typeof f.mimeType === 'string' && f.mimeType ? f.mimeType : 'application/octet-stream') ||
            'application/octet-stream';
        const safeName = (f.fileName || 'download').replace(/["\r\n]/g, '_').slice(0, 200);
        res.setHeader('Content-Type', ct);
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        return res.status(200).send(buf);
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
            userId: res.locals.auth_userId,
        });
        if (!note) {
            return res.status(404).json({ message: 'Note not found or unauthorized' });
        }

        // delete file from s3
        if (note?.fileUrl) {
            console.log('note.fileUrl: ', note.fileUrl);
            const fileUrlParts = note.fileUrl.split('/');
            console.log('fileUrlParts: ', fileUrlParts);
            const fileName = fileUrlParts[fileUrlParts.length - 1];
            if (fileName) {
                await deleteFileByPath({
                    userId: res.locals.auth_userId,
                    parentEntityId: note?.threadId?.toString() || '',
                    fileName: fileName,
                });
            }
        }

        return res.json({ message: 'Note deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;