import mongoose from 'mongoose';
import path from 'path';

import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserFileUpload } from '../../../../schema/schemaUser/SchemaUserFileUpload.schema';
import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { getApiKeyByObject, type tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';
import { getFile, StorageType } from '../../../../utils/upload/uploadFunc';
import { AGENT_OPENCODE_UPLOADS_DIR } from './agentOpencodeConstants';
import {
    agentOpencodeListDir,
    agentOpencodeWriteFile,
    type AgentOpencodeShellConfig,
} from './agentOpencodeWorkspace';

export type AgentOpencodeSyncedUpload = {
    workspaceRelPath: string;
    originalName: string;
    fileUploadPath: string;
};

type RecordToSync = {
    idPrefix: string;
    fileUploadPath: string;
    originalName?: string;
    contentType?: string;
    storageType?: StorageType;
};

const cleanFileName = (raw: string): string =>
    String(raw || 'file').replace(/[^\w.\- ()[\]]+/g, '_') || 'file';

/**
 * Copy thread uploads into `agent-workspace/uploads/` (isolated from Agent beta).
 */
export const syncAgentOpencodeUploads = async ({
    userId,
    threadId,
    shell,
    paths,
    apiKeys,
}: {
    userId: mongoose.Types.ObjectId | string;
    threadId: mongoose.Types.ObjectId | string;
    shell: AgentOpencodeShellConfig;
    paths: { uploadsDir: string };
    apiKeys?: tsUserApiKey | null;
}): Promise<AgentOpencodeSyncedUpload[]> => {
    const synced: AgentOpencodeSyncedUpload[] = [];
    try {
        const threadIdStr = String(threadId);
        let keys = apiKeys || null;
        if (!keys) {
            const apiKeyDoc = await ModelUserApiKey.findOne({ userId });
            if (!apiKeyDoc) return [];
            keys = getApiKeyByObject(apiKeyDoc);
        }

        const defaultStorageType: StorageType = keys.fileStorageType === 's3' ? 's3' : 'gridfs';
        const defaultS3Config =
            defaultStorageType === 's3' && keys.apiKeyS3Valid
                ? {
                      region: keys.apiKeyS3Region || 'auto',
                      endpoint: keys.apiKeyS3Endpoint || '',
                      accessKeyId: keys.apiKeyS3AccessKeyId || '',
                      secretAccessKey: keys.apiKeyS3SecretAccessKey || '',
                      bucketName: keys.apiKeyS3BucketName || '',
                  }
                : undefined;

        const directUploads = await ModelUserFileUpload.find({
            $or: [{ parentEntityId: threadIdStr }, { parentEntityId: String(threadIdStr) }],
        });

        const recordsToSync: RecordToSync[] = directUploads.map((rec) => ({
            idPrefix: String(rec._id),
            fileUploadPath: rec.fileUploadPath,
            originalName: rec.originalName,
            contentType: rec.contentType,
            storageType: rec.storageType === 's3' ? 's3' : 'gridfs',
        }));

        const chatMsgs = await ModelChatLlm.find({ threadId, userId }).select('content fileUrl fileUrlArr').lean();
        const extraPaths: string[] = [];
        const urlRegex = /getFile\?fileName=([^\s"'&\)]+)/g;
        const pushPath = (raw: string) => {
            const filePath = String(raw || '').trim();
            if (
                filePath &&
                !recordsToSync.some((r) => r.fileUploadPath === filePath) &&
                !extraPaths.includes(filePath)
            ) {
                extraPaths.push(filePath);
            }
        };
        for (const msg of chatMsgs) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            let match: RegExpExecArray | null;
            urlRegex.lastIndex = 0;
            while ((match = urlRegex.exec(content)) !== null) {
                pushPath(decodeURIComponent(match[1]));
            }
            if (typeof msg.fileUrl === 'string') pushPath(msg.fileUrl);
            if (Array.isArray(msg.fileUrlArr)) {
                for (const item of msg.fileUrlArr) {
                    if (typeof item === 'string') pushPath(item);
                }
            }
        }

        if (extraPaths.length > 0) {
            const foundUploads = await ModelUserFileUpload.find({
                fileUploadPath: { $in: extraPaths },
            });
            for (const pathItem of extraPaths) {
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

        if (recordsToSync.length === 0) {
            return [];
        }

        const existingFiles = await agentOpencodeListDir({
            shell,
            relativeDir: paths.uploadsDir,
            maxFiles: 500,
        });
        const existingByBase = new Map<string, number>();
        for (const file of existingFiles) {
            if (file.isDir) continue;
            const base = file.pathInFolder.split('/').pop() || '';
            if (base) existingByBase.set(base, file.size);
        }

        const processedPaths = new Set<string>();
        for (const item of recordsToSync) {
            if (!item.fileUploadPath || processedPaths.has(item.fileUploadPath)) continue;
            processedPaths.add(item.fileUploadPath);

            const rawOriginalName = item.originalName || path.basename(item.fileUploadPath) || 'file';
            const cleanOriginalName = cleanFileName(rawOriginalName);
            const prefixedFileName = cleanOriginalName.startsWith(`${item.idPrefix}_`)
                ? cleanOriginalName
                : `${item.idPrefix}_${cleanOriginalName}`;
            const workspaceRelPath = `${AGENT_OPENCODE_UPLOADS_DIR}/${prefixedFileName}`;
            const targetRelPath = `${paths.uploadsDir}/${prefixedFileName}`;

            const recordStorageType: StorageType = item.storageType === 's3' ? 's3' : 'gridfs';
            const s3ConfigToUse = recordStorageType === 's3' ? defaultS3Config : undefined;

            const downloadRes = await getFile({
                fileName: item.fileUploadPath,
                storageType: recordStorageType,
                s3Config: s3ConfigToUse,
            });
            if (!(downloadRes.success && downloadRes.content)) {
                continue;
            }

            const size = downloadRes.content.length;
            const existingSize = existingByBase.get(prefixedFileName);
            if (existingSize !== size) {
                await agentOpencodeWriteFile({
                    shell,
                    relativePath: targetRelPath,
                    buffer: downloadRes.content,
                    mimeType: item.contentType || 'application/octet-stream',
                });
                existingByBase.set(prefixedFileName, size);
            }

            synced.push({
                workspaceRelPath,
                originalName: cleanOriginalName,
                fileUploadPath: item.fileUploadPath,
            });
        }
    } catch (err) {
        console.error('syncAgentOpencodeUploads error:', err);
    }
    return synced;
};
