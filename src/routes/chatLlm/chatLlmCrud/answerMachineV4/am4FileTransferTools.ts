import mongoose from 'mongoose';
import path from 'path';
import mime from 'mime';

import { ModelAnswerMachineFileV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineFileV4.schema';
import { ModelAnswerMachineRequestV4 } from '../../../../schema/schemaChatLlm/SchemaAnswerMachine/SchemaAnswerMachineRequestV4.schema';
import { ModelUserFileUpload } from '../../../../schema/schemaUser/SchemaUserFileUpload.schema';
import type { tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';
import { constructFeatureUploadObjectKey } from '../../../../utils/upload/constructFeatureUploadObjectKey';
import { getFile, putFile } from '../../../../utils/upload/uploadFunc';
import type { StorageType } from '../../../../utils/upload/uploadFunc';

import {
    assertSafeAm4ShellRelativePath,
    buildAm4CanonicalShellPaths,
    extractAm4OutputCandidateFilenames,
} from './am4CanonicalPaths';

import { readBufferFromShellEngine, uploadBufferToShellEngine } from './am4ShellFileUpload';

export {
    assertSafeAm4ShellRelativePath,
    buildAm4CanonicalShellPaths,
    extractAm4OutputCandidateFilenames,
};

export type Am4ShellServiceConfig = {
    baseUrl: string;
    token: string;
};

function buildUserStorageOptions(apiKey: tsUserApiKey): {
    storageType: StorageType;
    s3Config?: {
        region: string;
        endpoint: string;
        accessKeyId: string;
        secretAccessKey: string;
        bucketName: string;
    };
} {
    const storageType: StorageType = apiKey.fileStorageType === 's3' ? 's3' : 'gridfs';
    if (storageType === 's3' && !apiKey.apiKeyS3Valid) {
        throw new Error('S3 is selected as storage but S3 credentials are not valid');
    }
    const s3Config =
        storageType === 's3'
            ? {
                  region: apiKey.apiKeyS3Region || 'auto',
                  endpoint: apiKey.apiKeyS3Endpoint || '',
                  accessKeyId: apiKey.apiKeyS3AccessKeyId || '',
                  secretAccessKey: apiKey.apiKeyS3SecretAccessKey || '',
                  bucketName: apiKey.apiKeyS3BucketName || '',
              }
            : undefined;
    return { storageType, s3Config };
}

/** Writes a tiny marker file so `workdirectory/` exists in the container before steps run. */
export async function ensureAm4ShellWorkDirectoryMarker(params: {
    shellCfg: Am4ShellServiceConfig;
    userObjectId: string;
    threadId: string;
}): Promise<void> {
    const paths = buildAm4CanonicalShellPaths({
        userObjectId: params.userObjectId,
        threadId: params.threadId,
    });
    const relativePath = paths.workDirectoryMarkerRelativePath;
    assertSafeAm4ShellRelativePath(relativePath);
    const markerText = Buffer.from(
        `# Answer Machine 4 workspace\n# userObjectId=${params.userObjectId}\n# threadId=${params.threadId}\n`,
        'utf8',
    );
    const written = await uploadBufferToShellEngine({
        baseUrl: params.shellCfg.baseUrl,
        token: params.shellCfg.token,
        relativePath,
        buffer: markerText,
        fileName: '.am4-workspace-marker',
        mimeType: 'text/plain',
        timeoutMs: 60_000,
    });
    if (!written.ok) {
        throw new Error(`AM4 workdirectory marker failed: ${written.error}`);
    }
}

/**
 * Reads bytes from user storage (S3 or GridFS) and writes them to the canonical AM4 **input** path
 * in the shell workspace (so OpenCode sees `/ai-notes-xyz-shell-files/.../chat/.../file`).
 */
export async function putFileFromUserStorageToAm4ShellWorkspace(params: {
    shellCfg: Am4ShellServiceConfig;
    apiKey: tsUserApiKey;
    userId: string;
    userObjectId: string;
    threadId: string;
    /** Key as returned by uploads / stored on `AnswerMachineFileV4.storedFileUrl`. */
    storageObjectKey: string;
    descriptiveFileName: string;
}): Promise<
    | { ok: true; shellRelativePath: string; absolutePath: string; byteLength: number }
    | { ok: false; error: string }
> {
    const storageKey = params.storageObjectKey.trim();
    if (!storageKey) {
        return { ok: false, error: 'storageObjectKey is empty' };
    }
    const { storageType, s3Config } = buildUserStorageOptions(params.apiKey);
    const pulled = await getFile({
        fileName: storageKey,
        storageType,
        s3Config,
    });
    if (!pulled.success || !pulled.content) {
        return { ok: false, error: pulled.error || 'getFile from user storage failed' };
    }
    const paths = buildAm4CanonicalShellPaths({
        userObjectId: params.userObjectId,
        threadId: params.threadId,
    });
    const relativePath = paths.inputFileRelativePath(params.descriptiveFileName);
    assertSafeAm4ShellRelativePath(relativePath);
    const contentType =
        pulled.contentType ||
        mime.getType(params.descriptiveFileName) ||
        'application/octet-stream';
    const pushed = await uploadBufferToShellEngine({
        baseUrl: params.shellCfg.baseUrl,
        token: params.shellCfg.token,
        relativePath,
        buffer: pulled.content,
        fileName: params.descriptiveFileName,
        mimeType: contentType,
        timeoutMs: 120_000,
    });
    if (!pushed.ok) {
        return { ok: false, error: pushed.error };
    }
    return {
        ok: true,
        shellRelativePath: pushed.relativePath,
        absolutePath: pushed.absolutePath,
        byteLength: pushed.size,
    };
}

/**
 * Copies an existing shell file (e.g. legacy `am4-uploads/...`) into the canonical input path.
 */
export async function copyExistingShellFileToAm4CanonicalInputPath(params: {
    shellCfg: Am4ShellServiceConfig;
    userObjectId: string;
    threadId: string;
    sourceShellRelativePath: string;
    descriptiveFileName: string;
    mimeType: string;
}): Promise<
    | { ok: true; shellRelativePath: string; absolutePath: string; byteLength: number }
    | { ok: false; error: string }
> {
    const src = params.sourceShellRelativePath.trim();
    if (!src || src.includes('..')) {
        return { ok: false, error: 'Invalid source shell relative path' };
    }
    assertSafeAm4ShellRelativePath(src);
    const read = await readBufferFromShellEngine({
        baseUrl: params.shellCfg.baseUrl,
        token: params.shellCfg.token,
        relativePath: src,
        timeoutMs: 120_000,
    });
    if (!read.ok) {
        return { ok: false, error: read.error };
    }
    const paths = buildAm4CanonicalShellPaths({
        userObjectId: params.userObjectId,
        threadId: params.threadId,
    });
    const destRel = paths.inputFileRelativePath(params.descriptiveFileName);
    assertSafeAm4ShellRelativePath(destRel);
    const written = await uploadBufferToShellEngine({
        baseUrl: params.shellCfg.baseUrl,
        token: params.shellCfg.token,
        relativePath: destRel,
        buffer: read.buffer,
        fileName: params.descriptiveFileName,
        mimeType: params.mimeType || 'application/octet-stream',
        timeoutMs: 120_000,
    });
    if (!written.ok) {
        return { ok: false, error: written.error };
    }
    return {
        ok: true,
        shellRelativePath: written.relativePath,
        absolutePath: written.absolutePath,
        byteLength: written.size,
    };
}

/**
 * At outer-iteration start: materializes AM4 attachments under the canonical shell paths so OpenCode
 * and prompts consistently reference `/ai-notes-xyz-shell-files/{userId}/chat/{threadId}/…`.
 */
export async function syncAm4RequestAttachmentsIntoCanonicalShellLayout(params: {
    shellCfg: Am4ShellServiceConfig;
    apiKey: tsUserApiKey;
    userId: string;
    userObjectId: string;
    threadId: mongoose.Types.ObjectId;
    attachments: Array<{
        _id: mongoose.Types.ObjectId;
        storedFileUrl?: string;
        fileName: string;
        mimeType?: string;
        shellRelativePath?: string;
        uploadStatus?: string;
    }>;
}): Promise<{ updatedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let updatedCount = 0;
    const canonicalPaths = buildAm4CanonicalShellPaths({
        userObjectId: params.userObjectId,
        threadId: String(params.threadId),
    });

    for (const doc of params.attachments) {
        if (doc.uploadStatus && doc.uploadStatus !== 'saved_to_shell') {
            continue;
        }
        const safeName = doc.fileName || 'file';
        const targetInputRel = canonicalPaths.inputFileRelativePath(safeName);
        try {
            assertSafeAm4ShellRelativePath(targetInputRel);
        } catch (err) {
            errors.push(`${safeName}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }

        if ((doc.storedFileUrl || '').trim()) {
            const transferred = await putFileFromUserStorageToAm4ShellWorkspace({
                shellCfg: params.shellCfg,
                apiKey: params.apiKey,
                userId: params.userId,
                userObjectId: params.userObjectId,
                threadId: String(params.threadId),
                storageObjectKey: doc.storedFileUrl!.trim(),
                descriptiveFileName: safeName,
            });
            if (!transferred.ok) {
                errors.push(`${safeName}: ${transferred.error}`);
                continue;
            }
            await ModelAnswerMachineFileV4.findByIdAndUpdate(doc._id, {
                $set: {
                    containerPath: transferred.absolutePath,
                    shellRelativePath: transferred.shellRelativePath,
                    uploadStatus: 'saved_to_shell',
                },
            });
            updatedCount += 1;
            continue;
        }

        const existingRel = (doc.shellRelativePath || '').trim();
        if (!existingRel || existingRel.includes('..')) {
            continue;
        }
        if (existingRel === targetInputRel) {
            continue;
        }
        try {
            assertSafeAm4ShellRelativePath(existingRel);
        } catch (err) {
            errors.push(`${safeName}: bad existing path — ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }

        const copied = await copyExistingShellFileToAm4CanonicalInputPath({
            shellCfg: params.shellCfg,
            userObjectId: params.userObjectId,
            threadId: String(params.threadId),
            sourceShellRelativePath: existingRel,
            descriptiveFileName: safeName,
            mimeType: doc.mimeType || 'application/octet-stream',
        });
        if (!copied.ok) {
            errors.push(`${safeName}: ${copied.error}`);
            continue;
        }
        await ModelAnswerMachineFileV4.findByIdAndUpdate(doc._id, {
            $set: {
                containerPath: copied.absolutePath,
                shellRelativePath: copied.shellRelativePath,
                uploadStatus: 'saved_to_shell',
            },
        });
        updatedCount += 1;
    }

    return { updatedCount, errors };
}

/**
 * Persists a user-upload record + object bytes to GridFS/S3, returns the storage key used by `/api/uploads/crud/getFile`.
 */
async function persistGeneratedBytesToUserStorage(params: {
    userId: string;
    threadId: mongoose.Types.ObjectId;
    apiKey: tsUserApiKey;
    originalFileName: string;
    buffer: Buffer;
    contentType: string;
}): Promise<{ objectKey: string }> {
    const { storageType, s3Config } = buildUserStorageOptions(params.apiKey);
    const tempRecord = await ModelUserFileUpload.create({
        userId: params.userId,
        fileUploadPath: `ai-notes-xyz/${params.userId}/temp/${Date.now()}.temp`,
        storageType,
    });
    const fileNameStem = tempRecord._id.toString();
    const extension = path.extname(params.originalFileName) || '.bin';
    const objectKey = constructFeatureUploadObjectKey(
        params.userId,
        String(params.threadId),
        fileNameStem,
        extension,
    );
    const uploadResult = await putFile({
        fileName: objectKey,
        fileContent: params.buffer,
        contentType: params.contentType,
        metadata: {
            userId: params.userId,
            parentEntityId: String(params.threadId),
            originalName: params.originalFileName,
            source: 'answer_machine_v4_shell_output',
        },
        storageType,
        s3Config,
    });
    if (!uploadResult.success) {
        await ModelUserFileUpload.deleteOne({ _id: tempRecord._id });
        throw new Error(uploadResult.error || 'putFile failed');
    }
    const updateData: Record<string, unknown> = {
        fileUploadPath: objectKey,
        storageType,
        parentEntityId: String(params.threadId),
        contentType: params.contentType,
        originalName: params.originalFileName,
        size: params.buffer.length,
    };
    if (storageType === 'gridfs' && uploadResult.fileId) {
        updateData.gridFsId = new mongoose.Types.ObjectId(uploadResult.fileId);
    }
    await ModelUserFileUpload.findByIdAndUpdate(tempRecord._id, { $set: updateData });
    return { objectKey };
}

/**
 * Reads each candidate output filename from the canonical **outputfile/** path, uploads to user storage,
 * and creates `answerMachineFileV4` rows (`fileRole: generated`) for UI download streams.
 */
export async function syncAm4AssistantOutputFilesFromShellToUserStorage(params: {
    shellCfg: Am4ShellServiceConfig;
    apiKey: tsUserApiKey;
    userId: string;
    userObjectId: string;
    threadId: mongoose.Types.ObjectId;
    answerMachineRequestV4Id: mongoose.Types.ObjectId;
    assistantAnswerText: string;
}): Promise<{ importedFileCount: number; attemptLog: string[] }> {
    const candidates = extractAm4OutputCandidateFilenames(params.assistantAnswerText);
    const attemptLog: string[] = [];
    if (candidates.length === 0) {
        return { importedFileCount: 0, attemptLog };
    }
    const paths = buildAm4CanonicalShellPaths({
        userObjectId: params.userObjectId,
        threadId: String(params.threadId),
    });
    let importedFileCount = 0;
    for (const name of candidates) {
        const outputRelativePath = paths.outputFileRelativePath(name);
        try {
            assertSafeAm4ShellRelativePath(outputRelativePath);
        } catch (err) {
            attemptLog.push(`${name}: invalid path — ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
        const read = await readBufferFromShellEngine({
            baseUrl: params.shellCfg.baseUrl,
            token: params.shellCfg.token,
            relativePath: outputRelativePath,
            timeoutMs: 120_000,
        });
        if (!read.ok) {
            attemptLog.push(`${name}: shell read failed (${read.error})`);
            continue;
        }
        if (read.buffer.length === 0) {
            attemptLog.push(`${name}: empty file skipped`);
            continue;
        }
        const contentType = mime.getType(name) || 'application/octet-stream';
        let objectKey: string;
        try {
            const persisted = await persistGeneratedBytesToUserStorage({
                userId: params.userId,
                threadId: params.threadId,
                apiKey: params.apiKey,
                originalFileName: name,
                buffer: read.buffer,
                contentType,
            });
            objectKey = persisted.objectKey;
        } catch (err) {
            attemptLog.push(`${name}: storage upload failed — ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
        const created = await ModelAnswerMachineFileV4.create({
            answerMachineRequestV4Id: params.answerMachineRequestV4Id,
            threadId: params.threadId,
            userId: params.userId,
            fileName: name.slice(0, 500),
            originalSize: read.buffer.length,
            mimeType: contentType.slice(0, 200),
            containerPath: '',
            shellRelativePath: outputRelativePath,
            uploadStatus: 'saved_to_shell',
            fileRole: 'generated',
            storedFileUrl: objectKey.slice(0, 4000),
        });
        await ModelAnswerMachineRequestV4.findByIdAndUpdate(params.answerMachineRequestV4Id, {
            $addToSet: { attachedFiles: created._id },
            $set: { updatedAt: new Date() },
        });
        importedFileCount += 1;
        attemptLog.push(`${name}: imported (${read.buffer.length} bytes) → ${objectKey}`);
    }
    return { importedFileCount, attemptLog };
}
