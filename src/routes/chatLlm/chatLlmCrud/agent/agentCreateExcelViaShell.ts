import mongoose from 'mongoose';
import path from 'path';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserFileUpload } from '../../../../schema/schemaUser/SchemaUserFileUpload.schema';
import { getApiKeyByObject, type tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';
import { constructFeatureUploadObjectKey } from '../../../../utils/upload/constructFeatureUploadObjectKey';
import { putFile, type StorageType } from '../../../../utils/upload/uploadFunc';
import {
    agentTaskFilePath,
    agentTaskFilesDir,
    getAgentShellConfig,
    shellExecuteCommand,
    shellPing,
    shellReadFile,
    shellWriteFile,
} from './agentShellWorkspace';

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
    const objectKey = constructFeatureUploadObjectKey(
        userId,
        String(threadId),
        tempRecord._id.toString(),
        path.extname(originalFileName) || '.xlsx',
    );
    const uploadResult = await putFile({
        fileName: objectKey,
        fileContent: buffer,
        contentType: EXCEL_MIME,
        metadata: {
            userId,
            parentEntityId: String(threadId),
            originalName: originalFileName,
            source: 'agent_create_excel_shell',
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

export type AgentCreateExcelViaShellInput = {
    userId: mongoose.Types.ObjectId | string;
    threadId: mongoose.Types.ObjectId;
    /** Usually agentInstanceId — used in ai-notes-xyz/task/{id}/files */
    taskId: string;
    fileName?: string;
    sheetName?: string;
    columns?: unknown;
    rows?: unknown;
    message?: string;
    aiModelProvider?: string;
    aiModelName?: string;
};

export type AgentCreateExcelViaShellResult = {
    success: boolean;
    errorReason: string;
    fileName: string;
    objectKey: string;
    rowCount: number;
    messageId: string | null;
    workspaceDir: string;
    shellAbsolutePath: string;
};

/**
 * Create Excel on the real Shell Engine under:
 *   ai-notes-xyz/task/{taskId}/files/
 * by writing data + a Python script, executing it, then importing the .xlsx
 * into user storage as a downloadable chat artifact.
 */
const agentCreateExcelViaShell = async (
    input: AgentCreateExcelViaShellInput,
): Promise<AgentCreateExcelViaShellResult> => {
    const userIdStr = String(input.userId);
    const fileName = sanitizeFileName(input.fileName || 'export.xlsx');
    const sheetName = String(input.sheetName || 'Sheet1').trim().slice(0, 31) || 'Sheet1';
    const rows = normalizeRows({ columns: input.columns, rows: input.rows });
    const workspaceDir = agentTaskFilesDir(input.taskId);

    const empty = (errorReason: string): AgentCreateExcelViaShellResult => ({
        success: false,
        errorReason,
        fileName,
        objectKey: '',
        rowCount: 0,
        messageId: null,
        workspaceDir,
        shellAbsolutePath: '',
    });

    if (rows.length === 0) {
        return empty('No rows provided for Excel file');
    }

    const apiKeyDoc = await ModelUserApiKey.findOne({ userId: input.userId });
    if (!apiKeyDoc) {
        return empty('User API keys not found');
    }
    const apiKey = getApiKeyByObject(apiKeyDoc);
    const shell = getAgentShellConfig(apiKey);
    if (!shell) {
        return empty(
            'Shell Engine is not configured. Set Shell Engine (or OpenCode-with-Shell shell URL/token) in Settings → API Keys.',
        );
    }

    const reachable = await shellPing(shell, 5_000);
    if (!reachable) {
        return empty(`Shell Engine host unreachable: ${shell.baseUrl}`);
    }

    const dataRel = agentTaskFilePath(input.taskId, `_data_${Date.now()}.json`);
    const scriptRel = agentTaskFilePath(input.taskId, `_gen_${Date.now()}.py`);
    const outRel = agentTaskFilePath(input.taskId, fileName);

    const dataWritten = await shellWriteFile({
        shell,
        relativePath: dataRel,
        buffer: Buffer.from(JSON.stringify({ sheetName, rows }, null, 2), 'utf8'),
        fileName: path.basename(dataRel),
        mimeType: 'application/json',
    });

    const script = `#!/usr/bin/env python3
import json, sys
from pathlib import Path
try:
    from openpyxl import Workbook
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--quiet', 'openpyxl'])
    from openpyxl import Workbook

data_path = Path(${JSON.stringify(dataWritten.absolutePath)})
out_path = Path(${JSON.stringify(dataWritten.absolutePath)}).parent / ${JSON.stringify(fileName)}
payload = json.loads(data_path.read_text(encoding='utf-8'))
rows = payload.get('rows') or []
sheet_name = (payload.get('sheetName') or 'Sheet1')[:31]
wb = Workbook()
ws = wb.active
ws.title = sheet_name
headers = list(rows[0].keys()) if rows else ['Empty']
ws.append(headers)
for row in rows:
    ws.append([row.get(h, '') for h in headers])
out_path.parent.mkdir(parents=True, exist_ok=True)
wb.save(out_path)
print('WROTE', str(out_path))
print('ROWS', len(rows))
`;

    const scriptWritten = await shellWriteFile({
        shell,
        relativePath: scriptRel,
        buffer: Buffer.from(script, 'utf8'),
        fileName: path.basename(scriptRel),
        mimeType: 'text/x-python',
    });

    await shellExecuteCommand({
        shell,
        // Redirect stderr: shell engine treats any stderr as failure; pip/python may write warnings there.
        command: `python ${JSON.stringify(scriptWritten.absolutePath)} 2>&1`,
        timeoutMs: 120_000,
    });

    const xlsxBuf = await shellReadFile({
        shell,
        relativePath: outRel,
        timeoutMs: 60_000,
    });
    if (xlsxBuf.length < 32) {
        return empty('Shell produced an empty Excel file');
    }

    // Resolve absolute path of output (same folder as data)
    const shellAbsolutePath = path.posix.join(
        path.posix.dirname(dataWritten.absolutePath.replace(/\\/g, '/')),
        fileName,
    );

    const { objectKey } = await persistBuffer({
        userId: userIdStr,
        threadId: input.threadId,
        apiKey,
        originalFileName: fileName,
        buffer: xlsxBuf,
    });

    const caption =
        (input.message || '').trim() ||
        `Excel file ready via Shell: **${fileName}** (${rows.length} rows).\nWorkspace: \`${workspaceDir}/\``;

    const created = await ModelChatLlm.create({
        type: 'text',
        content: caption,
        userId: userIdStr,
        threadId: input.threadId,
        isAi: true,
        tags: ['agent', 'agent-excel', 'shell'],
        aiModelProvider: input.aiModelProvider || '',
        aiModelName: input.aiModelName || '',
        shellRunArtifactV1: {
            version: 1,
            kind: 'shell_run',
            chatShellRunGroupId: new mongoose.Types.ObjectId(),
            threadId: input.threadId,
            userId: new mongoose.Types.ObjectId(userIdStr),
            completedAtUtc: new Date(),
            todos: [],
            importedFiles: [
                {
                    fileName,
                    mimeType: EXCEL_MIME,
                    storedFileUrl: objectKey,
                    relativePath: outRel,
                    summaryPreview: `${rows.length} rows in ${workspaceDir}`,
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
        rowCount: rows.length,
        messageId: String(created._id),
        workspaceDir,
        shellAbsolutePath,
    };
};

export default agentCreateExcelViaShell;
