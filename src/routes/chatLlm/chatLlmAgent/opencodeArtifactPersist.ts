import type mongoose from 'mongoose';
import path from 'path';

import { ModelUserFileUpload } from '../../../schema/schemaUser/SchemaUserFileUpload.schema';
import { tsUserApiKey } from '../../../utils/llm/llmCommonFunc';
import { putFile, S3Config } from '../../../utils/upload/uploadFunc';

import type { OpencodeTaskFileRef } from '../../../types/typesSchema/typesChatLlm/SchemaChatLlmOpencodeTask.types';

function getS3Config(userApiKey: tsUserApiKey): S3Config | undefined {
    if (userApiKey.fileStorageType !== 's3' || !userApiKey.apiKeyS3Valid) {
        return undefined;
    }
    return {
        region: userApiKey.apiKeyS3Region,
        endpoint: userApiKey.apiKeyS3Endpoint,
        accessKeyId: userApiKey.apiKeyS3AccessKeyId,
        secretAccessKey: userApiKey.apiKeyS3SecretAccessKey,
        bucketName: userApiKey.apiKeyS3BucketName,
    };
}

function safeFileName(input: string, fallback: string): string {
    const trimmed = (input || '').trim();
    if (!trimmed) return fallback;
    const base = path.basename(trimmed).replace(/[^a-zA-Z0-9._-]/g, '-');
    return base.length > 0 ? base : fallback;
}

export async function persistOpencodeTaskOutputFile({
    username,
    threadId,
    userApiKey,
    fileName,
    contentType,
    content,
}: {
    username: string;
    threadId: mongoose.Types.ObjectId;
    userApiKey: tsUserApiKey;
    fileName: string;
    contentType: string;
    content: Buffer;
}): Promise<{ success: boolean; fileRef: OpencodeTaskFileRef | null; errorReason: string }> {
    const storageType = userApiKey.fileStorageType === 's3' ? 's3' : 'gridfs';
    const s3Config = getS3Config(userApiKey);
    const safeName = safeFileName(fileName, `opencode-output-${Date.now()}.bin`);
    const objectKey = `ai-notes-xyz/${username}/features/${threadId.toString()}/opencode/${Date.now()}-${safeName}`;

    const putResult = await putFile({
        fileName: objectKey,
        fileContent: content,
        contentType,
        metadata: {
            username,
            parentEntityId: threadId.toString(),
            originalName: safeName,
        },
        storageType,
        s3Config,
    });

    if (!putResult.success) {
        return { success: false, fileRef: null, errorReason: putResult.error || 'Failed to store file' };
    }

    await ModelUserFileUpload.create({
        username,
        parentEntityId: threadId,
        fileUploadPath: objectKey,
        storageType,
        contentType,
        originalName: safeName,
        size: content.length,
        gridFsId: storageType === 'gridfs' && putResult.fileId ? putResult.fileId : undefined,
    });

    return {
        success: true,
        fileRef: {
            fileName: safeName,
            filePath: objectKey,
            contentType,
            size: content.length,
        },
        errorReason: '',
    };
}

