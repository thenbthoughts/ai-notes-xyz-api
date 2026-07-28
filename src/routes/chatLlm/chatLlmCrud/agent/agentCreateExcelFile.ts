import mongoose from 'mongoose';
import path from 'path';
import XLSX from 'xlsx';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserFileUpload } from '../../../../schema/schemaUser/SchemaUserFileUpload.schema';
import { getApiKeyByObject, type tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';
import { constructFeatureUploadObjectKey } from '../../../../utils/upload/constructFeatureUploadObjectKey';
import { putFile, type StorageType } from '../../../../utils/upload/uploadFunc';

const EXCEL_MIME =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const buildUserStorageOptions = (apiKey: tsUserApiKey): {
    storageType: StorageType;
    s3Config?: {
        region: string;
        endpoint: string;
        accessKeyId: string;
        secretAccessKey: string;
        bucketName: string;
    };
} => {
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
};

const sanitizeFileName = (raw: string): string => {
    const base = path.basename(String(raw || 'export').trim() || 'export')
        .replace(/[^\w.\- ()[\]]+/g, '_')
        .slice(0, 120);
    if (/\.xlsx$/i.test(base)) {
        return base;
    }
    return `${base.replace(/\.[^.]+$/, '') || 'export'}.xlsx`;
};

const normalizeRows = ({
    columns,
    rows,
}: {
    columns?: unknown;
    rows?: unknown;
}): Record<string, unknown>[] => {
    if (!Array.isArray(rows) || rows.length === 0) {
        return [];
    }

    const colNames = Array.isArray(columns)
        ? columns.map((c, i) => String(c || `Column ${i + 1}`).trim() || `Column ${i + 1}`)
        : [];

    return rows
        .map((row) => {
            if (row && typeof row === 'object' && !Array.isArray(row)) {
                const obj: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
                    obj[String(k).slice(0, 80)] = v == null ? '' : v;
                }
                return obj;
            }
            if (Array.isArray(row)) {
                const obj: Record<string, unknown> = {};
                row.forEach((cell, i) => {
                    const key = colNames[i] || `Column ${i + 1}`;
                    obj[key] = cell == null ? '' : cell;
                });
                return obj;
            }
            return null;
        })
        .filter((r): r is Record<string, unknown> => r !== null && Object.keys(r).length > 0)
        .slice(0, 5000);
};

const persistBuffer = async ({
    userId,
    threadId,
    apiKey,
    originalFileName,
    buffer,
}: {
    userId: string;
    threadId: mongoose.Types.ObjectId;
    apiKey: tsUserApiKey;
    originalFileName: string;
    buffer: Buffer;
}): Promise<{ objectKey: string }> => {
    const { storageType, s3Config } = buildUserStorageOptions(apiKey);
    const tempRecord = await ModelUserFileUpload.create({
        userId,
        fileUploadPath: `ai-notes-xyz/${userId}/temp/${Date.now()}.temp`,
        storageType,
    });
    const fileNameStem = tempRecord._id.toString();
    const extension = path.extname(originalFileName) || '.xlsx';
    const objectKey = constructFeatureUploadObjectKey(
        userId,
        String(threadId),
        fileNameStem,
        extension,
    );
    const uploadResult = await putFile({
        fileName: objectKey,
        fileContent: buffer,
        contentType: EXCEL_MIME,
        metadata: {
            userId,
            parentEntityId: String(threadId),
            originalName: originalFileName,
            source: 'agent_create_excel',
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
        parentEntityId: String(threadId),
        contentType: EXCEL_MIME,
        originalName: originalFileName,
        size: buffer.length,
    };
    if (storageType === 'gridfs' && uploadResult.fileId) {
        updateData.gridFsId = new mongoose.Types.ObjectId(uploadResult.fileId);
    }
    await ModelUserFileUpload.findByIdAndUpdate(tempRecord._id, { $set: updateData });
    return { objectKey };
};

export type AgentCreateExcelInput = {
    userId: mongoose.Types.ObjectId | string;
    threadId: mongoose.Types.ObjectId;
    fileName?: string;
    sheetName?: string;
    columns?: unknown;
    rows?: unknown;
    message?: string;
    aiModelProvider?: string;
    aiModelName?: string;
};

export type AgentCreateExcelResult = {
    success: boolean;
    errorReason: string;
    fileName: string;
    objectKey: string;
    rowCount: number;
    messageId: string | null;
};

/**
 * Build an .xlsx workbook from LLM-provided rows, store it for the user,
 * and post a chat message with a downloadable artifact.
 */
const agentCreateExcelFile = async (
    input: AgentCreateExcelInput,
): Promise<AgentCreateExcelResult> => {
    const userIdStr = String(input.userId);
    const fileName = sanitizeFileName(input.fileName || 'export.xlsx');
    const sheetName = String(input.sheetName || 'Sheet1').trim().slice(0, 31) || 'Sheet1';
    const rowObjects = normalizeRows({ columns: input.columns, rows: input.rows });

    if (rowObjects.length === 0) {
        return {
            success: false,
            errorReason: 'No rows provided for Excel file',
            fileName,
            objectKey: '',
            rowCount: 0,
            messageId: null,
        };
    }

    const apiKeyDoc = await ModelUserApiKey.findOne({ userId: input.userId });
    if (!apiKeyDoc) {
        return {
            success: false,
            errorReason: 'User storage settings not found',
            fileName,
            objectKey: '',
            rowCount: 0,
            messageId: null,
        };
    }
    const apiKey = getApiKeyByObject(apiKeyDoc);

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rowObjects);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const { objectKey } = await persistBuffer({
        userId: userIdStr,
        threadId: input.threadId,
        apiKey,
        originalFileName: fileName,
        buffer,
    });

    const caption =
        (input.message || '').trim() ||
        `Excel file ready: **${fileName}** (${rowObjects.length} row${rowObjects.length === 1 ? '' : 's'}). Use Download below.`;

    const created = await ModelChatLlm.create({
        type: 'text',
        content: caption,
        userId: userIdStr,
        threadId: input.threadId,
        isAi: true,
        tags: ['agent', 'agent-excel'],
        aiModelProvider: input.aiModelProvider || '',
        aiModelName: input.aiModelName || '',
        shellRunArtifactV1: {
            version: 1,
            kind: 'shell_run',
            chatShellRunGroupId: new mongoose.Types.ObjectId(),
            threadId: input.threadId,
            userId: typeof input.userId === 'string'
                ? new mongoose.Types.ObjectId(input.userId)
                : input.userId,
            completedAtUtc: new Date(),
            todos: [],
            importedFiles: [
                {
                    fileName,
                    mimeType: EXCEL_MIME,
                    storedFileUrl: objectKey,
                    relativePath: fileName,
                    summaryPreview: `${rowObjects.length} rows`,
                },
            ],
        },
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });

    return {
        success: true,
        errorReason: '',
        fileName,
        objectKey,
        rowCount: rowObjects.length,
        messageId: String(created._id),
    };
};

export default agentCreateExcelFile;
