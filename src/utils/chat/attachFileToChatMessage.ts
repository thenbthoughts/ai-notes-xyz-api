import mongoose from 'mongoose';
import path from 'path';

import { getMongodbObjectOrNull } from '../common/getMongodbObjectOrNull';
import { putFile } from '../upload/uploadFunc';
import { constructFeatureUploadObjectKey } from '../upload/constructFeatureUploadObjectKey';
import type { tsUserApiKey } from '../llm/llmCommonFunc';
import { ModelChatLlm } from '../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelUserFileUpload } from '../../schema/schemaUser/SchemaUserFileUpload.schema';
import IUserFileUpload from '../../types/typesSchema/typesUser/SchemaUserFileUpload.types';

export const collectMessageFileUrls = (msg: {
    fileUrl?: unknown;
    fileUrlArr?: unknown;
}): string[] => {
    const out: string[] = [];
    const push = (value: unknown) => {
        if (typeof value === 'string' && value.trim()) {
            out.push(value.trim());
        }
    };
    push(msg.fileUrl);
    if (Array.isArray(msg.fileUrlArr)) {
        for (const item of msg.fileUrlArr) {
            push(item);
        }
    } else if (typeof msg.fileUrlArr === 'string') {
        push(msg.fileUrlArr);
    }
    return Array.from(new Set(out));
};

const mimeFromFileName = (fileName: string, fallback: string): string => {
    const ext = path.extname(fileName).toLowerCase();
    const map: Record<string, string> = {
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.json': 'application/json',
        '.csv': 'text/csv',
        '.html': 'text/html',
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return map[ext] || fallback;
};

export type AttachFileToChatMessageResult =
    | {
          ok: true;
          id: string;
          messageId: string;
          fileName: string;
          originalName: string;
          size: number;
      }
    | { ok: false; status: number; message: string };

export const attachFileToChatMessage = async ({
    userId,
    apiKeys,
    messageIdRaw,
    fileName,
    contentBase64,
    content,
    mimeType,
}: {
    userId: mongoose.Types.ObjectId | string;
    apiKeys: tsUserApiKey;
    messageIdRaw: string;
    fileName: string;
    contentBase64?: string;
    content?: string;
    mimeType?: string;
}): Promise<AttachFileToChatMessageResult> => {
    const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const fileNameRaw = (fileName || '').trim();
    const messageId = getMongodbObjectOrNull((messageIdRaw || '').trim());
    if (!messageId) {
        return { ok: false, status: 400, message: 'messageId is required' };
    }
    if (!fileNameRaw) {
        return { ok: false, status: 400, message: 'fileName is required' };
    }

    let buffer: Buffer;
    const rawB64 = typeof contentBase64 === 'string' ? contentBase64.trim() : '';
    if (rawB64) {
        try {
            buffer = Buffer.from(rawB64, 'base64');
        } catch {
            return { ok: false, status: 400, message: 'contentBase64 is invalid' };
        }
    } else if (typeof content === 'string') {
        buffer = Buffer.from(content, 'utf8');
    } else {
        return { ok: false, status: 400, message: 'fileName and contentBase64 (or content) are required' };
    }
    if (!buffer.length) {
        return { ok: false, status: 400, message: 'File content is empty' };
    }
    if (buffer.length > 8 * 1024 * 1024) {
        return { ok: false, status: 400, message: 'File is larger than 8MB' };
    }

    const msg = await ModelChatLlm.findOne({ _id: messageId, userId: uid });
    if (!msg) {
        return { ok: false, status: 404, message: 'Chat message not found' };
    }
    const threadId = msg.threadId ? String(msg.threadId) : '';
    if (!threadId || !mongoose.Types.ObjectId.isValid(threadId)) {
        return { ok: false, status: 400, message: 'Chat message has no thread' };
    }

    const storageType = apiKeys.fileStorageType === 's3' ? 's3' : 'gridfs';
    if (storageType === 's3' && !apiKeys.apiKeyS3Valid) {
        return { ok: false, status: 400, message: 'S3 credentials not configured' };
    }

    const resolvedMime =
        typeof mimeType === 'string' && mimeType.trim()
            ? mimeType.trim()
            : mimeFromFileName(fileNameRaw, 'application/octet-stream');
    const fileExtension = path.extname(fileNameRaw) || '';

    const fileRecordObj = (await ModelUserFileUpload.create({
        userId: uid,
        fileUploadPath: `ai-notes-xyz/${uid}/temp/${Date.now()}.temp`,
        storageType,
    })) as IUserFileUpload;

    const fileNameStem = String(fileRecordObj._id);
    const objectKey = constructFeatureUploadObjectKey(String(uid), threadId, fileNameStem, fileExtension);
    const s3Config =
        storageType === 's3'
            ? {
                  region: apiKeys.apiKeyS3Region || 'auto',
                  endpoint: apiKeys.apiKeyS3Endpoint || '',
                  accessKeyId: apiKeys.apiKeyS3AccessKeyId || '',
                  secretAccessKey: apiKeys.apiKeyS3SecretAccessKey || '',
                  bucketName: apiKeys.apiKeyS3BucketName || '',
              }
            : undefined;

    const uploadResult = await putFile({
        fileName: objectKey,
        fileContent: buffer,
        contentType: resolvedMime,
        metadata: {
            userId: String(uid),
            parentEntityId: threadId,
            chatMessageId: String(messageId),
            originalName: fileNameRaw,
        },
        storageType,
        s3Config,
    });
    if (!uploadResult.success) {
        await ModelUserFileUpload.deleteOne({ _id: fileRecordObj._id });
        return { ok: false, status: 500, message: uploadResult.error || 'Upload failed' };
    }

    const updateData: Record<string, unknown> = {
        fileUploadPath: objectKey,
        storageType,
        parentEntityId: threadId,
        contentType: resolvedMime,
        originalName: fileNameRaw,
        size: buffer.length,
    };
    if (storageType === 'gridfs' && uploadResult.fileId) {
        updateData.gridFsId = new mongoose.Types.ObjectId(uploadResult.fileId);
    }
    await ModelUserFileUpload.findByIdAndUpdate(fileRecordObj._id, { $set: updateData });

    const existingUrls = collectMessageFileUrls(msg);
    if (!existingUrls.includes(objectKey)) {
        existingUrls.push(objectKey);
    }
    const nextFileUrl =
        typeof msg.fileUrl === 'string' && msg.fileUrl.trim() ? msg.fileUrl.trim() : objectKey;
    await ModelChatLlm.updateOne(
        { _id: msg._id, userId: uid },
        {
            $set: {
                fileUrl: nextFileUrl,
                fileUrlArr: existingUrls,
                updatedAtUtc: new Date(),
            },
        }
    );

    return {
        ok: true,
        id: String(fileRecordObj._id),
        messageId: String(msg._id),
        fileName: objectKey,
        originalName: fileNameRaw,
        size: buffer.length,
    };
};
