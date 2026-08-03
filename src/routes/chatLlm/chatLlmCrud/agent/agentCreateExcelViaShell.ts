import mongoose from 'mongoose';
import path from 'path';

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserFileUpload } from '../../../../schema/schemaUser/SchemaUserFileUpload.schema';
import { getApiKeyByObject, type tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';
import { constructFeatureUploadObjectKey } from '../../../../utils/upload/constructFeatureUploadObjectKey';
import { putFile, type StorageType } from '../../../../utils/upload/uploadFunc';
import { Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../answerMachineShared/answerMachineGetLlmConfig';
import {
    agentTaskFilePath,
    agentTaskFilesDir,
    getAgentShellConfig,
    shellExecuteCommand,
    shellPing,
    shellReadFile,
    shellWriteFile,
} from './agentShellWorkspace';
import writeAgentLog, { fetchLlmUnifiedLogged, type AgentLogContext } from './agentWriteLog';

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
    /** When set, every shell upload/download/execute is logged to agentLog */
    logCtx?: AgentLogContext | null;
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
 * Create Excel on the Shell Engine under:
 *   ai-notes-xyz-shell-files/task/{taskId}/files/
 * Node.js (First Preference) -> Python 3 (Second Preference) -> LLM Repair Fallback
 */
const agentCreateExcelViaShell = async (
    input: AgentCreateExcelViaShellInput,
): Promise<AgentCreateExcelViaShellResult> => {
    const userIdStr = String(input.userId);
    const fileName = sanitizeFileName(input.fileName || 'export.xlsx');
    const sheetName = String(input.sheetName || 'Sheet1').trim().slice(0, 31) || 'Sheet1';
    const rows = normalizeRows({ columns: input.columns, rows: input.rows });
    const chatId = String(input.threadId);
    const workspaceDir = agentTaskFilesDir(chatId);

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

    const reachable = await shellPing(shell, 5_000, input.logCtx);
    if (!reachable) {
        return empty(`Shell Engine host unreachable: ${shell.baseUrl}`);
    }

    const dataRel = agentTaskFilePath(chatId, `_data_${Date.now()}.json`);
    const nodeScriptRel = agentTaskFilePath(chatId, `_gen_${Date.now()}.js`);
    const pyScriptRel = agentTaskFilePath(chatId, `_gen_${Date.now()}.py`);
    const outRel = agentTaskFilePath(chatId, fileName);

    const dataWritten = await shellWriteFile({
        shell,
        relativePath: dataRel,
        buffer: Buffer.from(JSON.stringify({ sheetName, rows }, null, 2), 'utf8'),
        fileName: path.basename(dataRel),
        mimeType: 'application/json',
        logCtx: input.logCtx,
    });

    // ---------------------------------------------------
    // 1. FIRST PREFERENCE: Node.js Script (node)
    // ---------------------------------------------------
    const nodeScript = `
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let XLSX;
try {
    XLSX = require('xlsx');
} catch (e) {
    try {
        execSync('npm install --no-audit --no-fund xlsx', { stdio: 'inherit' });
        XLSX = require('xlsx');
    } catch (err) {
        console.error('npm install xlsx failed:', err.message);
    }
}

const dataPath = ${JSON.stringify(dataWritten.absolutePath)};
const outPath = path.join(path.dirname(dataPath), ${JSON.stringify(fileName)});
const payload = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const rows = payload.rows || [];
const sheetName = (payload.sheetName || 'Sheet1').slice(0, 31);

if (XLSX) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, outPath);
    console.log('WROTE_NODE', outPath);
    console.log('ROWS', rows.length);
} else {
    throw new Error('XLSX library unavailable in Node.js');
}
`;

    const nodeScriptWritten = await shellWriteFile({
        shell,
        relativePath: nodeScriptRel,
        buffer: Buffer.from(nodeScript, 'utf8'),
        fileName: path.basename(nodeScriptRel),
        mimeType: 'application/javascript',
        logCtx: input.logCtx,
    });

    let executionSuccess = false;
    let lastExecError = '';

    // Attempt 1: Node.js (First Preference)
    try {
        const nodeCmd = `node ${JSON.stringify(nodeScriptWritten.absolutePath)} 2>&1`;
        await shellExecuteCommand({
            shell,
            command: nodeCmd,
            timeoutMs: 120_000,
            logCtx: input.logCtx,
            executeFilePath: nodeScriptWritten.absolutePath,
        });
        executionSuccess = true;
    } catch (err) {
        lastExecError = err instanceof Error ? err.message : String(err);
        await writeAgentLog({
            agentInstanceId: input.logCtx?.agentInstanceId || new mongoose.Types.ObjectId(),
            userId: new mongoose.Types.ObjectId(userIdStr),
            threadId: input.threadId,
            action: 'shell_error',
            title: 'Node.js Excel script failed, trying Python 3 fallback',
            message: lastExecError,
            level: 'warn',
            tickNumber: input.logCtx?.tickNumber || 0,
        });
    }

    // Attempt 2: Python 3 (Second Preference)
    if (!executionSuccess) {
        const pyScript = `#!/usr/bin/env python3
import json, sys
from pathlib import Path
try:
    from openpyxl import Workbook
except ImportError:
    import subprocess
    try:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--quiet', 'openpyxl', '--break-system-packages'])
    except Exception:
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--quiet', 'openpyxl'])
        except Exception:
            subprocess.check_call(['apt-get', 'update', '-qq'])
            subprocess.check_call(['apt-get', 'install', '-y', '--no-install-recommends', 'python3-openpyxl'])
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
print('WROTE_PYTHON', str(out_path))
print('ROWS', len(rows))
`;

        const pyScriptWritten = await shellWriteFile({
            shell,
            relativePath: pyScriptRel,
            buffer: Buffer.from(pyScript, 'utf8'),
            fileName: path.basename(pyScriptRel),
            mimeType: 'text/x-python',
            logCtx: input.logCtx,
        });

        const scriptPathStr = JSON.stringify(pyScriptWritten.absolutePath);
        // Try python3 first, then python
        const pyCmd = `python3 ${scriptPathStr} 2>&1 || python ${scriptPathStr} 2>&1`;

        try {
            await shellExecuteCommand({
                shell,
                command: pyCmd,
                timeoutMs: 120_000,
                logCtx: input.logCtx,
                executeFilePath: pyScriptWritten.absolutePath,
            });
            executionSuccess = true;
        } catch (err) {
            lastExecError = err instanceof Error ? err.message : String(err);
        }
    }

    // Attempt 3: Call LLM for Alternate Solution & Retry
    if (!executionSuccess && input.logCtx) {
        try {
            const llmConfig = await getLlmConfig({ threadId: input.threadId });
            if (llmConfig) {
                await writeAgentLog({
                    agentInstanceId: input.logCtx.agentInstanceId,
                    userId: new mongoose.Types.ObjectId(userIdStr),
                    threadId: input.threadId,
                    action: 'llm_call_start',
                    title: 'LLM → Requesting alternate shell repair solution',
                    message: `Both Node.js and Python shell runs failed. Asking LLM for alternate solution. Error: ${lastExecError}`,
                    level: 'warn',
                    tickNumber: input.logCtx.tickNumber || 0,
                });

                const repairMessages: Message[] = [
                    {
                        role: 'system',
                        content:
                            'You are a shell execution repair engineer. The primary script failed. Provide a 1-line bash shell command that writes an Excel (.xlsx) file containing tabular data using Node.js, Python 3, or standard CLI utilities. Return JSON: {"command": "bash command to execute"}',
                    },
                    {
                        role: 'user',
                        content: `Execution error log:\n${lastExecError}\n\nData JSON file path: ${dataWritten.absolutePath}\nOutput file path: ${dataWritten.absolutePath.replace(/_data_\d+\.json$/, fileName)}`,
                    },
                ];

                const llmRepairRes = await fetchLlmUnifiedLogged({
                    logCtx: input.logCtx,
                    purpose: 'agent_shell_repair_llm',
                    params: {
                        provider: llmConfig.provider,
                        apiKey: llmConfig.apiKey,
                        apiEndpoint: llmConfig.apiEndpoint,
                        model: llmConfig.model,
                        messages: repairMessages,
                        temperature: 0.2,
                        maxTokens: 1000,
                        responseFormat: 'json_object',
                    },
                });

                let repairCmd = '';
                try {
                    const parsed = JSON.parse(llmRepairRes.content || '{}');
                    repairCmd = typeof parsed.command === 'string' ? parsed.command.trim() : '';
                } catch {
                    /* pass */
                }

                if (repairCmd) {
                    await shellExecuteCommand({
                        shell,
                        command: `${repairCmd} 2>&1`,
                        timeoutMs: 120_000,
                        logCtx: input.logCtx,
                    });
                    executionSuccess = true;
                }
            }
        } catch (repairErr) {
            console.error('LLM repair attempt failed:', repairErr);
        }
    }

    if (!executionSuccess) {
        return empty(`Shell Excel execution failed: ${lastExecError}`);
    }

    const xlsxBuf = await shellReadFile({
        shell,
        relativePath: outRel,
        timeoutMs: 60_000,
        logCtx: input.logCtx,
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
