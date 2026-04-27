import axios from 'axios';
import FormData from 'form-data';
import mongoose from 'mongoose';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import type IUserApiKey from '../../../../types/typesSchema/typesUser/SchemaUserApiKey.types';
import type { S3Config } from '../../../../utils/upload/uploadFunc';
import { getFile } from '../../../../utils/upload/uploadFunc';

const LOG = '[shellWorkspaceFileUpload]';

/** Types whose stored file is copied to the shell sandbox as raw bytes (not executed as shell). */
const UPLOADABLE_MESSAGE_TYPES = new Set([
    'document',
    'file',
    'image',
    'video',
    'audio',
]);

const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;
const MAX_FILES_PER_RUN = 3;
const RECENT_USER_MESSAGE_SCAN = 14;

function safeShellFileBaseName(fileUrl: string): string {
    const raw = (fileUrl.split('/').pop() || 'upload.bin').trim();
    const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, '_');
    return cleaned.length > 0 ? cleaned.slice(0, 160) : 'upload.bin';
}

function buildS3Config(keys: {
    apiKeyS3Region: string;
    apiKeyS3Endpoint: string;
    apiKeyS3AccessKeyId: string;
    apiKeyS3SecretAccessKey: string;
    apiKeyS3BucketName: string;
}): S3Config {
    return {
        region: keys.apiKeyS3Region || 'auto',
        endpoint: keys.apiKeyS3Endpoint || '',
        accessKeyId: keys.apiKeyS3AccessKeyId || '',
        secretAccessKey: keys.apiKeyS3SecretAccessKey || '',
        bucketName: keys.apiKeyS3BucketName || '',
    };
}

/**
 * Copies recent user-attached documents from app storage into the shell service workspace
 * (`ai-notes-xyz-shell-files/...`) so planner/commands can run on those paths.
 */
export async function uploadRecentUserFilesToShellWorkspace(params: {
    threadId: mongoose.Types.ObjectId;
    username: string;
    apiBase: string;
    token: string;
    userKeyDoc: IUserApiKey;
    keys: {
        apiKeyS3Region: string;
        apiKeyS3Endpoint: string;
        apiKeyS3AccessKeyId: string;
        apiKeyS3SecretAccessKey: string;
        apiKeyS3BucketName: string;
    };
}): Promise<{ relativePaths: string[]; hintForPlanner: string }> {
    const { threadId, username, apiBase, token, userKeyDoc, keys } = params;
    const relativePaths: string[] = [];

    const recent = await ModelChatLlm.find({
        threadId,
        username,
        isAi: false,
    })
        .sort({ createdAtUtc: -1 })
        .limit(RECENT_USER_MESSAGE_SCAN)
        .lean();

    const seenFileUrls = new Set<string>();
    const candidates: Array<{ messageId: mongoose.Types.ObjectId; fileUrl: string; type: string }> = [];

    for (const row of recent) {
        const fu = typeof row.fileUrl === 'string' ? row.fileUrl.trim() : '';
        if (!fu || seenFileUrls.has(fu)) {
            continue;
        }
        const t = typeof row.type === 'string' ? row.type : '';
        if (!UPLOADABLE_MESSAGE_TYPES.has(t)) {
            continue;
        }
        seenFileUrls.add(fu);
        candidates.push({ messageId: row._id as mongoose.Types.ObjectId, fileUrl: fu, type: t });
        if (candidates.length >= MAX_FILES_PER_RUN) {
            break;
        }
    }

    if (candidates.length === 0) {
        return { relativePaths: [], hintForPlanner: '' };
    }

    const storageType = userKeyDoc.fileStorageType === 's3' ? 's3' : 'gridfs';
    const s3Config = storageType === 's3' ? buildS3Config(keys) : undefined;

    for (const c of candidates) {
        const baseName = safeShellFileBaseName(c.fileUrl);
        const relativePath = `ai-notes-xyz-shell-files/thread-${String(threadId)}/msg-${String(c.messageId)}-${baseName}`;

        const fileResult = await getFile({
            fileName: c.fileUrl,
            storageType,
            s3Config,
        });

        if (!fileResult.success || !fileResult.content) {
            console.log(LOG, 'skip — getFile failed', { fileUrl: c.fileUrl, error: fileResult.error });
            continue;
        }

        const buf = fileResult.content;
        if (buf.length > MAX_UPLOAD_BYTES) {
            console.log(LOG, 'skip — file too large', { fileUrl: c.fileUrl, bytes: buf.length });
            continue;
        }

        try {
            const form = new FormData();
            form.append('relativePath', relativePath.replace(/\\/g, '/'));
            form.append('file', buf, { filename: baseName });

            const writeRes = await axios.post(`${apiBase}/shell-engine/file/write`, form, {
                headers: {
                    ...form.getHeaders(),
                    'X-API-Token': token,
                },
                maxBodyLength: MAX_UPLOAD_BYTES + 2_000_000,
                maxContentLength: MAX_UPLOAD_BYTES + 2_000_000,
                timeout: 120_000,
                validateStatus: () => true,
            });

            if (writeRes.status !== 201) {
                console.log(LOG, 'shell file/write failed', {
                    status: writeRes.status,
                    data: writeRes.data,
                    relativePath,
                });
                continue;
            }

            relativePaths.push(relativePath);
            console.log(LOG, 'uploaded', { relativePath, bytes: buf.length });
        } catch (e) {
            console.log(LOG, 'shell file/write error', { relativePath, err: e });
        }
    }

    if (relativePaths.length === 0) {
        return { relativePaths: [], hintForPlanner: '' };
    }

    const hintForPlanner =
        '[Shell workspace: the following file(s) were uploaded for this run — use these **exact** paths (or basename only; shell cwd is this folder) in every shellExecute that reads the file. For ImageMagick/ffmpeg use the real filename, never placeholders like input_file: ' +
        relativePaths.join(' | ') +
        ']';

    return { relativePaths, hintForPlanner };
}
