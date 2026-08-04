import mongoose from 'mongoose';
import path from 'path';

import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserFileUpload } from '../../../../schema/schemaUser/SchemaUserFileUpload.schema';
import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import { getFile, StorageType } from '../../../../utils/upload/uploadFunc';
import { getAgentShellConfig, shellWriteFile } from './agentShellWorkspace';
import { AgentLogContext } from './agentWriteLog';

/**
 * Sync user attachments & inline message photos for a chat thread:
 *   Storage (R2/S3/GridFS) -> Buffer -> ai-notes-xyz-shell-files/agent/${chat_id}/uploads/${recordId}_${fileName}
 * Executed dynamically at agent runtime when starting/ticking.
 */
export const syncThreadUploadsToAgentWorkspace = async ({
    userId,
    threadId,
    logCtx,
}: {
    userId: mongoose.Types.ObjectId | string;
    threadId: mongoose.Types.ObjectId | string;
    logCtx?: AgentLogContext | null;
}): Promise<void> => {
    try {
        const userIdStr = String(userId);
        const threadIdStr = String(threadId);

        const apiKeyDoc = await ModelUserApiKey.findOne({ userId });
        if (!apiKeyDoc) return;
        const apiKey = getApiKeyByObject(apiKeyDoc);
        const shell = getAgentShellConfig(apiKey);
        if (!shell) return;

        const defaultStorageType: StorageType = apiKey.fileStorageType === 's3' ? 's3' : 'gridfs';
        const defaultS3Config = defaultStorageType === 's3' && apiKey.apiKeyS3Valid ? {
            region: apiKey.apiKeyS3Region || 'auto',
            endpoint: apiKey.apiKeyS3Endpoint || '',
            accessKeyId: apiKey.apiKeyS3AccessKeyId || '',
            secretAccessKey: apiKey.apiKeyS3SecretAccessKey || '',
            bucketName: apiKey.apiKeyS3BucketName || '',
        } : undefined;

        // 1. Query uploads associated by parentEntityId
        const directUploads = await ModelUserFileUpload.find({
            $or: [
                { parentEntityId: threadIdStr },
                { parentEntityId: String(threadIdStr) },
            ],
        });

        const recordsToSync: Array<{
            idPrefix: string;
            fileUploadPath: string;
            originalName?: string;
            contentType?: string;
            storageType?: StorageType;
        }> = directUploads.map((rec) => ({
            idPrefix: String(rec._id),
            fileUploadPath: rec.fileUploadPath,
            originalName: rec.originalName,
            contentType: rec.contentType,
            storageType: rec.storageType === 's3' ? 's3' : 'gridfs',
        }));

        // 2. Scan chat messages for getFile?fileName=... URL references
        const chatMsgs = await ModelChatLlm.find({ threadId }).select('content').lean();
        const urlRegex = /getFile\?fileName=([^\s"'&\)]+)/g;

        const additionalFilePaths: string[] = [];
        for (const msg of chatMsgs) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            let match: RegExpExecArray | null;
            while ((match = urlRegex.exec(content)) !== null) {
                const rawPath = decodeURIComponent(match[1]);
                if (rawPath && !recordsToSync.some((r) => r.fileUploadPath === rawPath) && !additionalFilePaths.includes(rawPath)) {
                    additionalFilePaths.push(rawPath);
                }
            }
        }

        if (additionalFilePaths.length > 0) {
            const foundUploads = await ModelUserFileUpload.find({
                fileUploadPath: { $in: additionalFilePaths },
            });

            for (const pathItem of additionalFilePaths) {
                const matchedRec = foundUploads.find((u) => u.fileUploadPath === pathItem);
                const fileStem = path.basename(pathItem, path.extname(pathItem));
                recordsToSync.push({
                    idPrefix: matchedRec ? String(matchedRec._id) : fileStem,
                    fileUploadPath: pathItem,
                    originalName: matchedRec?.originalName || path.basename(pathItem),
                    contentType: matchedRec?.contentType,
                    storageType: matchedRec?.storageType === 's3' ? 's3' : defaultStorageType,
                });
            }
        }

        if (recordsToSync.length === 0) return;

        const processedPaths = new Set<string>();

        for (const item of recordsToSync) {
            if (processedPaths.has(item.fileUploadPath)) continue;
            processedPaths.add(item.fileUploadPath);

            const rawOriginalName = item.originalName || path.basename(item.fileUploadPath) || 'file';
            const cleanOriginalName = rawOriginalName.replace(/[^\w.\- ()[\]]+/g, '_');

            // Format prefix: {idPrefix}_{cleanOriginalName}
            const prefixedFileName = cleanOriginalName.startsWith(`${item.idPrefix}_`)
                ? cleanOriginalName
                : `${item.idPrefix}_${cleanOriginalName}`;

            const targetRelPath = `ai-notes-xyz-shell-files/agent/${threadIdStr}/uploads/${prefixedFileName}`;

            const recordStorageType: StorageType = item.storageType === 's3' ? 's3' : 'gridfs';
            const s3ConfigToUse = recordStorageType === 's3' ? defaultS3Config : undefined;

            // Read R2/S3/GridFS -> Buffer
            const downloadRes = await getFile({
                fileName: item.fileUploadPath,
                storageType: recordStorageType,
                s3Config: s3ConfigToUse,
            });

            if (downloadRes.success && downloadRes.content) {
                // Upload Buffer -> Shell Engine workspace path under uploads/
                await shellWriteFile({
                    shell,
                    relativePath: targetRelPath,
                    buffer: downloadRes.content,
                    fileName: prefixedFileName,
                    mimeType: item.contentType || 'application/octet-stream',
                    logCtx,
                });
            }
        }
    } catch (err) {
        console.error('syncThreadUploadsToAgentWorkspace runtime sync error:', err);
    }
};

export default syncThreadUploadsToAgentWorkspace;
