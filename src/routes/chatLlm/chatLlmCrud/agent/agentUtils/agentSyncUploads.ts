import mongoose from 'mongoose';
import path from 'path';
import axios from 'axios';

import { ModelUserApiKey } from '../../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserFileUpload } from '../../../../../schema/schemaUser/SchemaUserFileUpload.schema';
import { ModelChatLlm } from '../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { getApiKeyByObject } from '../../../../../utils/llm/llmCommonFunc';
import { getFile, StorageType } from '../../../../../utils/upload/uploadFunc';
import { agentTaskFilesDir, getAgentShellConfig, shellWriteFile, type AgentShellConfig } from './agentShell/agentShellWorkspace';
import { AgentLogContext, writeAgentLogFromContext } from './agentWriteLog';

type ShellListedFile = { relativePath: string; size: number };

const listShellFilesQuiet = async (
    shell: AgentShellConfig,
    relativeDir: string
): Promise<ShellListedFile[]> => {
    try {
        const shellRes = await axios.get(`${shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/list`, {
            params: { relativeDir, maxFiles: 500 },
            timeout: 8_000,
            headers: { 'X-API-Token': shell.token },
            validateStatus: () => true,
        });
        if (shellRes.status !== 200 || !shellRes.data || typeof shellRes.data !== 'object') {
            return [];
        }
        const raw = (shellRes.data as { files?: unknown }).files;
        if (!Array.isArray(raw)) return [];
        return raw
            .map((item) => {
                if (!item || typeof item !== 'object') return null;
                const o = item as Record<string, unknown>;
                const rel = typeof o.relativePath === 'string' ? o.relativePath.replace(/\\/g, '/') : '';
                if (!rel) return null;
                return {
                    relativePath: rel,
                    size: typeof o.size === 'number' ? o.size : -1,
                };
            })
            .filter((x): x is ShellListedFile => x !== null);
    } catch {
        return [];
    }
};

/**
 * Sync user attachments & inline message photos for a chat thread:
 *   Storage (R2/S3/GridFS) -> Buffer -> ai-notes-xyz-shell-files/agent/${chat_id}/uploads/${recordId}_${fileName}
 *
 * Skips re-upload when the same basename already exists in the shell workspace with the same byte size.
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
        const threadIdStr = String(threadId);

        const apiKeyDoc = await ModelUserApiKey.findOne({ userId });
        if (!apiKeyDoc) return;
        const apiKey = getApiKeyByObject(apiKeyDoc);
        const shell = getAgentShellConfig(apiKey);
        if (!shell) return;

        const defaultStorageType: StorageType = apiKey.fileStorageType === 's3' ? 's3' : 'gridfs';
        const defaultS3Config =
            defaultStorageType === 's3' && apiKey.apiKeyS3Valid
                ? {
                      region: apiKey.apiKeyS3Region || 'auto',
                      endpoint: apiKey.apiKeyS3Endpoint || '',
                      accessKeyId: apiKey.apiKeyS3AccessKeyId || '',
                      secretAccessKey: apiKey.apiKeyS3SecretAccessKey || '',
                      bucketName: apiKey.apiKeyS3BucketName || '',
                  }
                : undefined;

        const directUploads = await ModelUserFileUpload.find({
            $or: [{ parentEntityId: threadIdStr }, { parentEntityId: String(threadIdStr) }],
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

        const chatMsgs = await ModelChatLlm.find({ threadId }).select('content').lean();
        const urlRegex = /getFile\?fileName=([^\s"'&\)]+)/g;

        const additionalFilePaths: string[] = [];
        for (const msg of chatMsgs) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            let match: RegExpExecArray | null;
            while ((match = urlRegex.exec(content)) !== null) {
                const rawPath = decodeURIComponent(match[1]);
                if (
                    rawPath &&
                    !recordsToSync.some((r) => r.fileUploadPath === rawPath) &&
                    !additionalFilePaths.includes(rawPath)
                ) {
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

        const agentDir = agentTaskFilesDir(threadIdStr);
        const uploadsDir = `${agentDir}/uploads`;
        const existingFiles = await listShellFilesQuiet(shell, uploadsDir);
        const existingByBase = new Map<string, number>();
        for (const f of existingFiles) {
            existingByBase.set(path.basename(f.relativePath), f.size);
        }

        const processedPaths = new Set<string>();
        let skipped = 0;
        let uploaded = 0;

        for (const item of recordsToSync) {
            if (processedPaths.has(item.fileUploadPath)) continue;
            processedPaths.add(item.fileUploadPath);

            const rawOriginalName = item.originalName || path.basename(item.fileUploadPath) || 'file';
            const cleanOriginalName = rawOriginalName.replace(/[^\w.\- ()[\]]+/g, '_');

            const prefixedFileName = cleanOriginalName.startsWith(`${item.idPrefix}_`)
                ? cleanOriginalName
                : `${item.idPrefix}_${cleanOriginalName}`;

            const targetRelPath = `${uploadsDir}/${prefixedFileName}`;

            const recordStorageType: StorageType = item.storageType === 's3' ? 's3' : 'gridfs';
            const s3ConfigToUse = recordStorageType === 's3' ? defaultS3Config : undefined;

            const downloadRes = await getFile({
                fileName: item.fileUploadPath,
                storageType: recordStorageType,
                s3Config: s3ConfigToUse,
            });

            if (!(downloadRes.success && downloadRes.content)) continue;

            const size = downloadRes.content.length;
            const existingSize = existingByBase.get(prefixedFileName);
            if (existingSize === size) {
                skipped += 1;
                continue;
            }

            await shellWriteFile({
                shell,
                relativePath: targetRelPath,
                buffer: downloadRes.content,
                fileName: prefixedFileName,
                mimeType: item.contentType || 'application/octet-stream',
                logCtx,
            });
            existingByBase.set(prefixedFileName, size);
            uploaded += 1;
        }

        if (logCtx && uploaded > 0) {
            await writeAgentLogFromContext(logCtx, {
                action: 'shell_upload',
                title: `Uploads sync: ${uploaded} new, ${skipped} skipped`,
                message: `Thread uploads synced (${uploaded} uploaded, ${skipped} already present)`,
                level: 'info',
                payload: { uploaded, skipped, uploadsDir },
            });
        }
    } catch (err) {
        console.error('syncThreadUploadsToAgentWorkspace runtime sync error:', err);
    }
};

export default syncThreadUploadsToAgentWorkspace;
