import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';
import fileUpload from 'express-fileupload';

import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { deleteFileByPath } from '../../upload/uploadFileS3ForFeatures';
import { mergeAnswerMachineV3StreamIntoNotes } from './utils/mergeAnswerMachineV3StreamIntoNotes';
import { recordAnswerMachineFileArtifact } from './answerMachineFileService';
import type { S3Config } from '../../../utils/upload/uploadFunc';
import type { tsUserApiKey } from '../../../utils/llm/llmCommonFunc';
import {
    aggregateAnswerMachineRequestV3UnionThread,
    type AnswerMachineRequestV3UnionThreadItem,
} from './utils/answerMachineRequestV3UnionThreadAggregate';

// Router
const router = Router();

const answerMachineV3FileUploadMw = fileUpload({
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

        const threadDoc = await ModelChatLlmThread.findOne({
            _id: threadId,
            username: res.locals.auth_username,
        })
            .select('answerEngine')
            .lean();

        let threadAm3UnionTimeline: AnswerMachineRequestV3UnionThreadItem[] | undefined;
        if (threadDoc?.answerEngine === 'answerMachine3') {
            threadAm3UnionTimeline = await aggregateAnswerMachineRequestV3UnionThread({
                username: res.locals.auth_username,
                threadId,
            });
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
                username: res.locals.auth_username,
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

        const docsWithAm3 = await mergeAnswerMachineV3StreamIntoNotes({
            username: res.locals.auth_username,
            threadId,
            chatDocs: resultNotes as Record<string, unknown>[],
        });

        return res.json({
            message: 'Notes retrieved successfully',
            count: docsWithAm3.length,
            totalCount: totalCount,
            docs: docsWithAm3,
            hasMore: (skip + limit) < totalCount,
            ...(threadAm3UnionTimeline !== undefined ? { threadAm3UnionTimeline } : {}),
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

/**
 * Upload a file and attach it to an Answer Machine V3 run (`answerMachineFilesV3` + user file storage).
 * Multipart field name: `file`. Body: `threadId`, `answerMachineRequestV3Id`, optional `answerMachineIteration`, optional `description`.
 */
router.post(
    '/answerMachineFileV3Upload',
    middlewareUserAuth,
    answerMachineV3FileUploadMw,
    async (req: Request, res: Response) => {
        try {
            const username = res.locals.auth_username;
            const apiKey = res.locals.apiKey as tsUserApiKey;

            if (!req.files || typeof req.files !== 'object' || !req.files.file) {
                return res.status(400).json({ message: 'Missing file (field name: file)' });
            }
            const raw = req.files.file;
            const file = Array.isArray(raw) ? raw[0] : raw;
            if (!file || !file.data || !file.name) {
                return res.status(400).json({ message: 'Invalid upload' });
            }

            const { threadId: tid, answerMachineRequestV3Id: rid, answerMachineIteration: iterRaw, description } =
                req.body as Record<string, string | undefined>;

            if (typeof tid !== 'string' || !mongoose.Types.ObjectId.isValid(tid)) {
                return res.status(400).json({ message: 'Invalid threadId' });
            }
            if (typeof rid !== 'string' || !mongoose.Types.ObjectId.isValid(rid)) {
                return res.status(400).json({ message: 'Invalid answerMachineRequestV3Id' });
            }

            const threadObjectId = mongoose.Types.ObjectId.createFromHexString(tid);
            const requestObjectId = mongoose.Types.ObjectId.createFromHexString(rid);

            const threadOk = await ModelChatLlmThread.findOne({
                _id: threadObjectId,
                username,
            })
                .select('_id')
                .lean();
            if (!threadOk) {
                return res.status(404).json({ message: 'Thread not found' });
            }

            let iteration: number | null = null;
            if (typeof iterRaw === 'string' && iterRaw.trim() !== '') {
                const n = Number(iterRaw);
                if (!Number.isFinite(n) || n < 1) {
                    return res.status(400).json({ message: 'Invalid answerMachineIteration' });
                }
                iteration = Math.floor(n);
            }

            const storageType = apiKey.fileStorageType === 's3' ? 's3' : 'gridfs';
            const s3Config: S3Config | undefined =
                storageType === 's3' && apiKey.apiKeyS3Valid
                    ? {
                          region: apiKey.apiKeyS3Region || 'auto',
                          endpoint: apiKey.apiKeyS3Endpoint || '',
                          accessKeyId: apiKey.apiKeyS3AccessKeyId || '',
                          secretAccessKey: apiKey.apiKeyS3SecretAccessKey || '',
                          bucketName: apiKey.apiKeyS3BucketName || '',
                      }
                    : undefined;
            if (storageType === 's3' && !apiKey.apiKeyS3Valid) {
                return res.status(400).json({ message: 'S3 not configured for this account' });
            }

            const recorded = await recordAnswerMachineFileArtifact({
                username,
                threadId: threadObjectId,
                answerMachineRequestV3Id: requestObjectId,
                answerMachineIteration: iteration,
                answerMachineSubQuestionV3Id: null,
                fileType: 'user_upload',
                purpose: 'user_attachment',
                description:
                    typeof description === 'string' && description.trim()
                        ? description.trim().slice(0, 2000)
                        : 'Uploaded from Answer Machine 3 pipeline UI',
                fileBuffer: file.data,
                contentType: file.mimetype || 'application/octet-stream',
                suggestedBaseName: file.name,
                storageType,
                s3Config,
                metadata: { source: 'answer_machine_v3_ui_upload' },
            });

            if (!recorded.ok) {
                return res.status(400).json({ message: recorded.error });
            }

            return res.status(201).json({
                message: 'File attached to Answer Machine V3 run',
                id: recorded.id,
                storedFileUrl: recorded.storedFileUrl,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    },
);

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

        // delete file from s3
        if (note?.fileUrl) {
            console.log('note.fileUrl: ', note.fileUrl);
            const fileUrlParts = note.fileUrl.split('/');
            console.log('fileUrlParts: ', fileUrlParts);
            const fileName = fileUrlParts[fileUrlParts.length - 1];
            if (fileName) {
                await deleteFileByPath({
                    username: res.locals.auth_username,
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