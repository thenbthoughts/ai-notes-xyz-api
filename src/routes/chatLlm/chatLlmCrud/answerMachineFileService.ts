import mongoose from 'mongoose';
import path from 'path';

import { ModelAnswerMachineFileV3 } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineFileV3.schema';
import { ModelAnswerMachineRequestV3 } from '../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV3.schema';
import { ModelUserFileUpload } from '../../../schema/schemaUser/SchemaUserFileUpload.schema';
import IUserFileUpload from '../../../types/typesSchema/typesUser/SchemaUserFileUpload.types';
import type {
    AnswerMachineFilePurposeV3,
    AnswerMachineFileTypeV3,
} from '../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineFileV3.types';
import { constructFeatureUploadObjectKey } from '../../../utils/upload/constructFeatureUploadObjectKey';
import { putFile, type S3Config } from '../../../utils/upload/uploadFunc';

const IMPORT_CAP_BYTES = 45 * 1024 * 1024;

export type RecordAnswerMachineFileArtifactParams = {
    username: string;
    threadId: mongoose.Types.ObjectId;
    answerMachineRequestV3Id: mongoose.Types.ObjectId;
    answerMachineIteration?: number | null;
    answerMachineSubQuestionV3Id?: mongoose.Types.ObjectId | null;

    fileType: AnswerMachineFileTypeV3;
    purpose: AnswerMachineFilePurposeV3;

    description?: string;
    metadata?: Record<string, unknown>;
    relativeShellPath?: string;

    /** When provided, uploads bytes and registers the resulting storage key (shell-generated artifacts). */
    fileBuffer?: Buffer;
    contentType?: string;
    suggestedBaseName?: string;

    /** When no buffer is passed, registers an existing storage key (e.g. chat attachment already in GridFS/S3). */
    storedFileUrl?: string;
    originalName?: string;
    mimeType?: string;
    sizeBytes?: number;

    storageType?: 's3' | 'gridfs';
    s3Config?: S3Config;
};

export type RecordAnswerMachineFileArtifactResult =
    | { ok: true; id: string; storedFileUrl: string }
    | { ok: false; error: string };

/**
 * Validates that an Answer Machine V3 request belongs to the caller, then either uploads fresh bytes
 * or attaches metadata for an existing object key. Persists one row in `answerMachineFilesV3`.
 */
export async function recordAnswerMachineFileArtifact(
    params: RecordAnswerMachineFileArtifactParams,
): Promise<RecordAnswerMachineFileArtifactResult> {
    const request = await ModelAnswerMachineRequestV3.findOne({
        _id: params.answerMachineRequestV3Id,
        username: params.username,
        threadId: params.threadId,
    }).lean();

    if (!request) {
        return { ok: false, error: 'Answer Machine request not found for user/thread.' };
    }

    let resolvedKey = (params.storedFileUrl || '').trim();
    let resolvedMime = params.mimeType || params.contentType || 'application/octet-stream';
    let resolvedName = (params.originalName || params.suggestedBaseName || 'artifact').trim() || 'artifact';
    let resolvedSize = typeof params.sizeBytes === 'number' ? params.sizeBytes : 0;

    if (params.fileBuffer && params.fileBuffer.length > 0) {
        const buf = params.fileBuffer;
        if (buf.length > IMPORT_CAP_BYTES) {
            return { ok: false, error: `Artifact exceeds max size (${IMPORT_CAP_BYTES} bytes).` };
        }

        const storageType = params.storageType ?? 'gridfs';
        const s3Config = params.s3Config;

        const baseFromPath =
            params.relativeShellPath?.split('/').pop()?.trim() ||
            params.suggestedBaseName?.trim() ||
            'shell-output.bin';
        const safeBase = baseFromPath.replace(/[^\w.\-]+/g, '_').slice(0, 160) || 'shell-output.bin';
        const fileExtension = path.extname(safeBase) || '.bin';

        const placeholder = (await ModelUserFileUpload.create({
            username: params.username,
            fileUploadPath: `ai-notes-xyz/${params.username}/temp/${Date.now()}.temp`,
            storageType,
        })) as IUserFileUpload;

        const stem = placeholder._id.toString();
        const objectKey = constructFeatureUploadObjectKey(
            params.username,
            String(params.threadId),
            stem,
            fileExtension,
        );

        const put = await putFile({
            fileName: objectKey,
            fileContent: buf,
            contentType: params.contentType || 'application/octet-stream',
            storageType,
            s3Config,
            metadata: {
                source: 'answerMachineFilesV3',
                threadId: String(params.threadId),
                answerMachineRequestV3Id: String(params.answerMachineRequestV3Id),
            },
        });

        if (!put.success || !put.fileId) {
            await ModelUserFileUpload.deleteOne({ _id: placeholder._id });
            return { ok: false, error: put.error || 'putFile failed for Answer Machine artifact.' };
        }

        const updateData: Record<string, unknown> = {
            fileUploadPath: objectKey,
            storageType,
            parentEntityId: String(params.threadId),
            contentType: params.contentType || resolvedMime,
            originalName: safeBase,
            size: buf.length,
        };
        if (storageType === 'gridfs' && mongoose.Types.ObjectId.isValid(put.fileId)) {
            updateData.gridFsId = new mongoose.Types.ObjectId(put.fileId);
        }
        await ModelUserFileUpload.findOneAndUpdate({ _id: placeholder._id }, { $set: updateData });

        resolvedKey = objectKey;
        resolvedMime = params.contentType || resolvedMime;
        resolvedName = safeBase;
        resolvedSize = buf.length;
    }

    if (!resolvedKey) {
        return { ok: false, error: 'Missing storedFileUrl or fileBuffer for Answer Machine artifact.' };
    }

    const doc = await ModelAnswerMachineFileV3.create({
        answerMachineRequestV3Id: params.answerMachineRequestV3Id,
        answerMachineIteration:
            typeof params.answerMachineIteration === 'number' && Number.isFinite(params.answerMachineIteration)
                ? params.answerMachineIteration
                : null,
        answerMachineSubQuestionV3Id: params.answerMachineSubQuestionV3Id ?? null,
        threadId: params.threadId,
        username: params.username,
        fileType: params.fileType,
        purpose: params.purpose,
        storedFileUrl: resolvedKey,
        originalName: resolvedName,
        mimeType: resolvedMime,
        sizeBytes: resolvedSize,
        relativeShellPath: params.relativeShellPath?.trim() || '',
        description: params.description?.trim() || '',
        metadata: params.metadata && typeof params.metadata === 'object' ? params.metadata : {},
        createdAtUtc: new Date(),
    });

    return { ok: true, id: String(doc._id), storedFileUrl: resolvedKey };
}

/** Removes all file rows for a request (e.g. when cleaning up a cancelled or deleted run). */
export async function deleteAnswerMachineFilesByRequestId(params: {
    answerMachineRequestV3Id: mongoose.Types.ObjectId;
    username: string;
}): Promise<{ deletedCount: number }> {
    const res = await ModelAnswerMachineFileV3.deleteMany({
        answerMachineRequestV3Id: params.answerMachineRequestV3Id,
        username: params.username,
    });
    return { deletedCount: res.deletedCount ?? 0 };
}
