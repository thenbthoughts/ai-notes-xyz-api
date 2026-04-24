import mongoose from 'mongoose';
import mime from 'mime';
import path from 'path';
import { spawn } from 'child_process';
import axios, { AxiosRequestConfig } from 'axios';

import { ModelUserFileUpload } from '../../../../schema/schemaUser/SchemaUserFileUpload.schema';
import { tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';
import { getFile, putFile, S3Config } from '../../../../utils/upload/uploadFunc';

type ToolAction =
    | {
          type: 'create_text_file';
          fileName: string;
          content: string;
          description?: string;
      }
    | {
          type: 'create_image_file';
          fileName: string;
          imageUrl?: string;
          imageBase64?: string;
          contentType?: string;
          description?: string;
      }
    | {
          type: 'create_csv_file';
          fileName: string;
          content?: string;
          headers: string[];
          rows: Array<Array<string | number | boolean | null>>;
          description?: string;
      }
    | {
          type: 'create_excel_file';
          fileName: string;
          xlsxBase64?: string;
          sheets: Array<{
              name: string;
              headers: string[];
              rows: Array<Array<string | number | boolean | null>>;
          }>;
          description?: string;
      }
    | {
          type: 'create_svg_graph';
          fileName: string;
          chartType: 'line' | 'bar';
          title?: string;
          xLabel?: string;
          yLabel?: string;
          svgContent?: string;
          labels: string[];
          values: number[];
          description?: string;
      }
    | {
          type: 'create_canvas_html';
          fileName: string;
          title?: string;
          htmlContent?: string;
          labels: string[];
          values: number[];
          description?: string;
      }
    | {
          type: 'edit_text_file';
          targetFileName: string;
          mode: 'append' | 'overwrite' | 'replace';
          content?: string;
          searchText?: string;
          replaceWith?: string;
          outputFileName?: string;
          description?: string;
      };

interface ToolPlan {
    shouldExecute: boolean;
    assistantContextNote: string;
    actions: ToolAction[];
}

const OPCODE_TIMEOUT_MS = 25_000;

export interface GeneratedArtifact {
    fileName: string;
    filePath: string;
    description: string;
    previewText: string;
    contentType: string;
    messageType: 'image' | 'document';
}

export interface ToolExecutionResult {
    executed: boolean;
    summary: string;
    artifacts: GeneratedArtifact[];
}

interface RunAiWorkspaceToolsInput {
    username: string;
    threadId: mongoose.Types.ObjectId;
    userApiKey: tsUserApiKey;
    latestUserPrompt: string;
}

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
    if (!trimmed) {
        return fallback;
    }
    const base = path.basename(trimmed).replace(/[^a-zA-Z0-9._-]/g, '-');
    return base.length > 0 ? base : fallback;
}

function clampPreview(value: string, maxChars: number = 5000): string {
    if (value.length <= maxChars) {
        return value;
    }
    return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

async function saveArtifactFile({
    username,
    threadId,
    userApiKey,
    fileName,
    content,
    contentType,
}: {
    username: string;
    threadId: mongoose.Types.ObjectId;
    userApiKey: tsUserApiKey;
    fileName: string;
    content: Buffer;
    contentType: string;
}): Promise<{ success: boolean; filePath: string; error: string }> {
    const storageType = userApiKey.fileStorageType === 's3' ? 's3' : 'gridfs';
    const s3Config = getS3Config(userApiKey);
    const safeName = safeFileName(fileName, `artifact-${Date.now()}.txt`);
    const objectKey = `ai-notes-xyz/${username}/features/${threadId.toString()}/ai-artifacts/${Date.now()}-${safeName}`;

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
        return {
            success: false,
            filePath: '',
            error: putResult.error || 'Failed to store artifact',
        };
    }

    const updateData: {
        username: string;
        parentEntityId: mongoose.Types.ObjectId;
        fileUploadPath: string;
        storageType: 'gridfs' | 's3';
        contentType: string;
        originalName: string;
        size: number;
        gridFsId?: mongoose.Types.ObjectId;
    } = {
        username,
        parentEntityId: threadId,
        fileUploadPath: objectKey,
        storageType,
        contentType,
        originalName: safeName,
        size: content.length,
    };
    if (storageType === 'gridfs' && putResult.fileId) {
        updateData.gridFsId = new mongoose.Types.ObjectId(putResult.fileId);
    }

    await ModelUserFileUpload.create(updateData);
    return {
        success: true,
        filePath: objectKey,
        error: '',
    };
}

async function getExistingThreadFileByName({
    username,
    threadId,
    targetFileName,
}: {
    username: string;
    threadId: mongoose.Types.ObjectId;
    targetFileName: string;
}) {
    const baseName = safeFileName(targetFileName, targetFileName);
    return await ModelUserFileUpload.findOne({
        username,
        parentEntityId: threadId,
        $or: [{ originalName: baseName }, { fileUploadPath: { $regex: `${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` } }],
    }).sort({ createdAtUtc: -1 });
}

function applyTextEdit({
    sourceText,
    mode,
    content,
    searchText,
    replaceWith,
}: {
    sourceText: string;
    mode: 'append' | 'overwrite' | 'replace';
    content?: string;
    searchText?: string;
    replaceWith?: string;
}): string {
    if (mode === 'append') {
        return `${sourceText}${sourceText.endsWith('\n') ? '' : '\n'}${content || ''}`;
    }
    if (mode === 'overwrite') {
        return content || '';
    }
    if (!searchText || searchText.length === 0) {
        return sourceText;
    }
    return sourceText.split(searchText).join(replaceWith || '');
}

function normalizePlan(input: unknown): ToolPlan {
    const fallback: ToolPlan = {
        shouldExecute: false,
        assistantContextNote: '',
        actions: [],
    };
    if (!input || typeof input !== 'object') {
        return fallback;
    }
    const payload = input as Record<string, unknown>;
    return {
        shouldExecute: payload.shouldExecute === true,
        assistantContextNote: typeof payload.assistantContextNote === 'string' ? payload.assistantContextNote : '',
        actions: Array.isArray(payload.actions) ? (payload.actions as ToolAction[]) : [],
    };
}

function extractJsonObject(text: string): string {
    const raw = text.trim();
    if (raw.startsWith('{') && raw.endsWith('}')) {
        return raw;
    }
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return raw.slice(firstBrace, lastBrace + 1);
    }
    return '';
}

function looksImageRequest(prompt: string): boolean {
    const normalized = prompt.toLowerCase();
    return (
        normalized.includes('image') ||
        normalized.includes('photo') ||
        normalized.includes('picture') ||
        normalized.includes('wallpaper')
    );
}

function extractImageUrlCandidates(text: string): string[] {
    const regex = /https?:\/\/[^\s)'"`]+/gi;
    const urls = text.match(regex) || [];
    const filtered = urls.filter((u) => {
        const low = u.toLowerCase();
        return (
            low.endsWith('.png') ||
            low.endsWith('.jpg') ||
            low.endsWith('.jpeg') ||
            low.endsWith('.webp') ||
            low.includes('picsum.photos') ||
            low.includes('pexels.com/photo') ||
            low.includes('pixabay.com/get/')
        );
    });
    return filtered.slice(0, 3);
}

function buildImagePlanFromText({
    userPrompt,
    sourceText,
}: {
    userPrompt: string;
    sourceText: string;
}): ToolPlan | null {
    if (!looksImageRequest(userPrompt)) {
        return null;
    }
    const imageUrls = extractImageUrlCandidates(sourceText);
    if (imageUrls.length < 1) {
        return null;
    }
    return {
        shouldExecute: true,
        assistantContextNote: 'OpenCode provided image URLs. Using the first URL to create an image artifact.',
        actions: [
            {
                type: 'create_image_file',
                fileName: `opencode-image-${Date.now()}.jpg`,
                imageUrl: imageUrls[0],
                description: 'Image generated from OpenCode URL output.',
            },
        ],
    };
}

async function runCommandWithTimeout({
    command,
    args,
    timeoutMs,
}: {
    command: string;
    args: string[];
    timeoutMs: number;
}): Promise<{ success: boolean; stdout: string; stderr: string }> {
    return await new Promise((resolve) => {
        const child = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
        });

        let stdout = '';
        let stderr = '';
        let done = false;

        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            child.kill('SIGTERM');
            resolve({
                success: false,
                stdout,
                stderr: `${stderr}\nTimed out after ${timeoutMs}ms`,
            });
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on('error', (err) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({
                success: false,
                stdout,
                stderr: `${stderr}\n${err.message}`,
            });
        });
        child.on('close', (code) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({
                success: code === 0,
                stdout,
                stderr,
            });
        });
    });
}

function getOpencodeApiBaseUrl(userApiKey: tsUserApiKey): string {
    const fromUser = (userApiKey.apiKeyOpencodeEndpoint || '').trim();
    if (fromUser.length >= 1) {
        return fromUser.replace(/\/+$/, '');
    }
    const fromEnv = (process.env.OPENCODE_API_BASE_URL || '').trim();
    if (fromEnv.length >= 1) {
        return fromEnv.replace(/\/+$/, '');
    }
    return '';
}

/**
 * The workspace-tool planner can call a local `opencode` binary as a fallback when the HTTP
 * API does not return a usable plan. Spawning that binary without it installed (common on
 * Windows) leads to `spawn opencode ENOENT` and confuses users who only use the remote server.
 * Only try the local CLI when there is a remote base URL to justify fallback, the user
 * explicitly enabled local CLI, or they set OPENCODE_BIN.
 */
function shouldAttemptLocalOpencodeCli(userApiKey: tsUserApiKey): boolean {
    if (getOpencodeApiBaseUrl(userApiKey).length >= 1) {
        return true;
    }
    if ((process.env.OPENCODE_ENABLE_LOCAL_CLI || '').trim() === 'true') {
        return true;
    }
    if ((process.env.OPENCODE_BIN || '').trim().length >= 1) {
        return true;
    }
    return false;
}

function formatOpencodeLocalCliErrorSummary(cliErrors: string[]): string {
    const uniq = [...new Set(cliErrors.map((e) => e.trim()).filter((e) => e.length > 0))];
    if (uniq.length === 0) {
        return '';
    }
    const allSpawnMissing = uniq.every(
        (e) => e.includes('ENOENT') || e.includes('No such file') || e.includes('not recognized')
    );
    if (allSpawnMissing) {
        return (
            'local OpenCode CLI is not on PATH (spawn failed). ' +
            'Set OPENCODE_BIN to the full path of the `opencode` executable, or install the CLI, ' +
            'or rely on the OpenCode server URL in API settings so the app does not need a local binary.'
        );
    }
    return uniq.slice(0, 2).join(' | ');
}

function getOpencodeApiHeaders(userApiKey: tsUserApiKey): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    const apiKey = (userApiKey.apiKeyOpencode || '').trim();
    if (apiKey.length >= 1) {
        headers['x-api-key'] = apiKey;
        headers['x-opencode-api-key'] = apiKey;
    }
    return headers;
}

function getOpencodeTextFromMessagePayload(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    const root = payload as Record<string, unknown>;
    const candidates: unknown[] = [];

    if (Array.isArray(root.parts)) {
        candidates.push(...root.parts);
    }
    if (root.data && typeof root.data === 'object') {
        const dataObj = root.data as Record<string, unknown>;
        if (Array.isArray(dataObj.parts)) {
            candidates.push(...dataObj.parts);
        }
    }

    const chunks: string[] = [];
    for (const part of candidates) {
        if (!part || typeof part !== 'object') {
            continue;
        }
        const p = part as Record<string, unknown>;
        if (typeof p.text === 'string' && p.text.trim().length >= 1) {
            chunks.push(p.text.trim());
            continue;
        }
        if (typeof p.content === 'string' && p.content.trim().length >= 1) {
            chunks.push(p.content.trim());
            continue;
        }
    }

    return chunks.join('\n').trim();
}

function extractSessionId(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
        return '';
    }
    const root = payload as Record<string, unknown>;
    if (typeof root.id === 'string' && root.id.length >= 1) {
        return root.id;
    }
    if (root.data && typeof root.data === 'object') {
        const dataObj = root.data as Record<string, unknown>;
        if (typeof dataObj.id === 'string' && dataObj.id.length >= 1) {
            return dataObj.id;
        }
    }
    return '';
}

async function tryRunOpencodeApiPrompt({
    userApiKey,
    instruction,
}: {
    userApiKey: tsUserApiKey;
    instruction: string;
}): Promise<{ output: string; errorReason: string }> {
    const baseUrl = getOpencodeApiBaseUrl(userApiKey);
    if (baseUrl.length < 1) {
        return {
            output: '',
            errorReason: 'OpenCode URL is not configured',
        };
    }

    const usernameRaw = (userApiKey.apiKeyOpencodeBasicAuthUsername || '').trim();
    const passwordRaw = userApiKey.apiKeyOpencodeBasicAuthPassword || '';
    const authConfig: AxiosRequestConfig['auth'] =
        passwordRaw.length >= 1
            ? {
                  username: usernameRaw || 'opencode',
                  password: passwordRaw,
              }
            : undefined;

    const requestConfig: AxiosRequestConfig = {
        headers: getOpencodeApiHeaders(userApiKey),
        timeout: OPCODE_TIMEOUT_MS,
        auth: authConfig,
    };

    let sessionId = '';
    let stage = 'create_session';
    try {
        const createSessionResult = await axios.post(
            `${baseUrl}/session`,
            {
                title: 'AI Notes Workspace Tools',
            },
            requestConfig
        );

        sessionId = extractSessionId(createSessionResult.data);
        if (sessionId.length < 1) {
            return {
                output: '',
                errorReason: `OpenCode API returned empty session id at ${baseUrl}/session`,
            };
        }

        stage = 'send_message';
        const promptResult = await axios.post(
            `${baseUrl}/session/${encodeURIComponent(sessionId)}/message`,
            {
                parts: [
                    {
                        type: 'text',
                        text: instruction,
                    },
                ],
            },
            requestConfig
        );

        return {
            output: getOpencodeTextFromMessagePayload(promptResult.data),
            errorReason: '',
        };
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const statusText = error.response?.statusText || '';
            const serverMessage =
                typeof error.response?.data?.message === 'string'
                    ? error.response?.data?.message
                    : typeof error.response?.data?.error === 'string'
                    ? error.response?.data?.error
                    : '';
            const details = [status ? `status ${status}` : '', statusText, serverMessage]
                .filter((item) => item && item.trim().length > 0)
                .join(' ');
            return {
                output: '',
                errorReason: `OpenCode API ${stage} failed (${baseUrl}): ${details || error.message}`,
            };
        }
        return {
            output: '',
            errorReason: `OpenCode API ${stage} failed (${baseUrl}): ${
                error instanceof Error ? error.message : 'Unknown error'
            }`,
        };
    } finally {
        if (sessionId.length >= 1) {
            try {
                await axios.delete(
                    `${baseUrl}/session/${encodeURIComponent(sessionId)}`,
                    requestConfig
                );
            } catch {
                // best effort cleanup; ignore failures
            }
        }
    }
}

async function generateToolPlanWithOpencode({
    userPrompt,
    userApiKey,
    threadId,
}: {
    userPrompt: string;
    userApiKey: tsUserApiKey;
    threadId: mongoose.Types.ObjectId;
}): Promise<{ plan: ToolPlan; usedOpencode: boolean; errorReason: string }> {
    const opencodeBin = process.env.OPENCODE_BIN || 'opencode';
    const plannerPrompt = `
You are OpenCode and your output will drive file operations.
Return STRICT JSON only.

Schema:
{
  "shouldExecute": boolean,
  "assistantContextNote": "short note",
  "actions": [
    {
      "type": "create_text_file" | "create_image_file" | "create_csv_file" | "create_excel_file" | "create_svg_graph" | "create_canvas_html" | "edit_text_file"
    }
  ]
}

Rules:
- Use shouldExecute true only when user explicitly asks to create/edit files, image/photo/picture, excel/csv, graph/chart, or canvas output.
- Max 3 actions.
- For image/photo requests, use create_image_file and include either imageUrl or imageBase64.
- For chart requests, prefer create_svg_graph or create_canvas_html.
- For create_svg_graph, you MUST include svgContent with full SVG markup.
- For create_canvas_html, you MUST include htmlContent with full HTML.
- For create_csv_file, you MUST include content with complete CSV.
- For create_excel_file, you MUST include xlsxBase64 binary workbook.
- For excel requests, use create_excel_file with realistic sheet headers/rows.
- For edit requests, use edit_text_file.
- Never wrap JSON in markdown.

User request:
${userPrompt}

File scope:
- Existing and target files are under /home/ai-notes-xyz/thread-${threadId.toString()}/*.
- When planning edit/create actions, assume this directory scope.
`.trim();

    const apiResult = await tryRunOpencodeApiPrompt({
        userApiKey,
        instruction: plannerPrompt,
    });
    if (apiResult.output.trim().length > 0) {
        const imagePlan = buildImagePlanFromText({
            userPrompt,
            sourceText: apiResult.output,
        });
        if (imagePlan) {
            return {
                plan: imagePlan,
                usedOpencode: true,
                errorReason: '',
            };
        }
        const jsonText = extractJsonObject(apiResult.output);
        if (jsonText.length > 0) {
            try {
                const parsed = JSON.parse(jsonText);
                const normalized = normalizePlan(parsed);
                const fallbackImagePlan = buildImagePlanFromText({
                    userPrompt,
                    sourceText: apiResult.output,
                });
                return {
                    plan: fallbackImagePlan || normalized,
                    usedOpencode: true,
                    errorReason: '',
                };
            } catch {
                // continue to CLI fallback
            }
        }
    }

    const candidates: string[][] = [
        ['run', plannerPrompt],
        ['exec', plannerPrompt],
        [plannerPrompt],
    ];
    const cliErrors: string[] = [];
    if (shouldAttemptLocalOpencodeCli(userApiKey)) {
        for (const args of candidates) {
            const result = await runCommandWithTimeout({
                command: opencodeBin,
                args,
                timeoutMs: OPCODE_TIMEOUT_MS,
            });
            if (!result.success || !result.stdout.trim()) {
                const stderrText = (result.stderr || '').trim();
                if (stderrText.length > 0) {
                    cliErrors.push(stderrText.slice(0, 240));
                }
                continue;
            }
            const imagePlan = buildImagePlanFromText({
                userPrompt,
                sourceText: result.stdout,
            });
            if (imagePlan) {
                return {
                    plan: imagePlan,
                    usedOpencode: true,
                    errorReason: '',
                };
            }
            const jsonText = extractJsonObject(result.stdout);
            if (!jsonText) {
                cliErrors.push('CLI returned non-JSON output');
                continue;
            }
            try {
                const parsed = JSON.parse(jsonText);
                const normalized = normalizePlan(parsed);
                const fallbackImagePlan = buildImagePlanFromText({
                    userPrompt,
                    sourceText: result.stdout,
                });
                return {
                    plan: fallbackImagePlan || normalized,
                    usedOpencode: true,
                    errorReason: '',
                };
            } catch {
                cliErrors.push('CLI returned invalid JSON');
                continue;
            }
        }
    }
    const errorParts: string[] = [];
    if (apiResult.errorReason.trim().length > 0) {
        errorParts.push(apiResult.errorReason.trim());
    }
    if (cliErrors.length > 0) {
        const cliSummary = formatOpencodeLocalCliErrorSummary(cliErrors);
        if (cliSummary.length > 0) {
            errorParts.push(cliSummary);
        }
    }
    return {
        plan: {
            shouldExecute: false,
            assistantContextNote: '',
            actions: [],
        },
        usedOpencode: false,
        errorReason:
            errorParts.join(' ; ') || 'OpenCode unavailable or returned invalid JSON plan',
    };
}

export async function runAiWorkspaceTools({
    username,
    threadId,
    userApiKey,
    latestUserPrompt,
}: RunAiWorkspaceToolsInput): Promise<ToolExecutionResult> {
    if (!latestUserPrompt || latestUserPrompt.trim().length < 5) {
        return { executed: false, summary: '', artifacts: [] };
    }

    const planResult = await generateToolPlanWithOpencode({
        userPrompt: latestUserPrompt,
        userApiKey,
        threadId,
    });
    const plan = planResult.plan;

    if (!plan.shouldExecute || plan.actions.length === 0) {
        if (!planResult.usedOpencode) {
            return {
                executed: false,
                summary: `OpenCode tool execution skipped: ${planResult.errorReason}`,
                artifacts: [],
            };
        }
        return {
            executed: false,
            summary: 'OpenCode responded but did not return executable tool actions.',
            artifacts: [],
        };
    }

    const artifacts: GeneratedArtifact[] = [];
    const errors: string[] = [];

    for (const action of plan.actions.slice(0, 3)) {
        try {
            if (action.type === 'create_image_file') {
                const name = safeFileName(action.fileName, 'image.png');
                const finalName = name;

                let imageBuffer: Buffer | null = null;
                let finalContentType = 'image/png';

                if (typeof action.imageBase64 === 'string' && action.imageBase64.trim().length > 0) {
                    try {
                        imageBuffer = Buffer.from(action.imageBase64.trim(), 'base64');
                    } catch {
                        errors.push(`${finalName}: invalid imageBase64`);
                        continue;
                    }
                    if (typeof action.contentType === 'string' && action.contentType.startsWith('image/')) {
                        finalContentType = action.contentType;
                    } else {
                        finalContentType = mime.getType(finalName) || 'image/png';
                    }
                } else if (typeof action.imageUrl === 'string' && action.imageUrl.trim().length > 0) {
                    try {
                        const imageResponse = await axios.get<ArrayBuffer>(action.imageUrl.trim(), {
                            responseType: 'arraybuffer',
                            timeout: OPCODE_TIMEOUT_MS,
                        });
                        imageBuffer = Buffer.from(imageResponse.data);
                        const headerType = imageResponse.headers['content-type'];
                        if (typeof headerType === 'string' && headerType.startsWith('image/')) {
                            finalContentType = headerType;
                        } else if (typeof action.contentType === 'string' && action.contentType.startsWith('image/')) {
                            finalContentType = action.contentType;
                        } else {
                            finalContentType = mime.getType(finalName) || 'image/png';
                        }
                    } catch (error) {
                        errors.push(`${finalName}: failed to download image from imageUrl`);
                        continue;
                    }
                } else {
                    errors.push(`${finalName}: OpenCode did not provide imageUrl or imageBase64`);
                    continue;
                }

                if (!imageBuffer || imageBuffer.length === 0) {
                    errors.push(`${finalName}: generated image is empty`);
                    continue;
                }

                const result = await saveArtifactFile({
                    username,
                    threadId,
                    userApiKey,
                    fileName: finalName,
                    content: imageBuffer,
                    contentType: finalContentType,
                });
                if (!result.success) {
                    errors.push(`${finalName}: ${result.error}`);
                    continue;
                }
                artifacts.push({
                    fileName: finalName,
                    filePath: result.filePath,
                    description: action.description || 'Image generated by AI tools.',
                    previewText: `Generated image (${finalContentType}, ${imageBuffer.length} bytes)`,
                    contentType: finalContentType,
                    messageType: 'image',
                });
                continue;
            }

            if (action.type === 'create_text_file') {
                const name = safeFileName(action.fileName, 'notes.txt');
                const content = Buffer.from(action.content || '', 'utf-8');
                const contentType = mime.getType(name) || 'text/plain';
                const result = await saveArtifactFile({
                    username,
                    threadId,
                    userApiKey,
                    fileName: name,
                    content,
                    contentType,
                });
                if (!result.success) {
                    errors.push(`${name}: ${result.error}`);
                    continue;
                }
                artifacts.push({
                    fileName: name,
                    filePath: result.filePath,
                    description: action.description || 'Text file generated by AI tools.',
                    previewText: clampPreview(action.content || ''),
                    contentType,
                    messageType: 'document',
                });
                continue;
            }

            if (action.type === 'create_csv_file') {
                const name = safeFileName(action.fileName, 'data.csv');
                if (!(typeof action.content === 'string' && action.content.trim().length > 0)) {
                    errors.push(`${name}: OpenCode did not provide CSV content`);
                    continue;
                }
                const csvText = action.content;
                const result = await saveArtifactFile({
                    username,
                    threadId,
                    userApiKey,
                    fileName: name.endsWith('.csv') ? name : `${name}.csv`,
                    content: Buffer.from(csvText, 'utf-8'),
                    contentType: 'text/csv',
                });
                if (!result.success) {
                    errors.push(`${name}: ${result.error}`);
                    continue;
                }
                artifacts.push({
                    fileName: name,
                    filePath: result.filePath,
                    description: action.description || 'CSV file generated by AI tools.',
                    previewText: clampPreview(csvText),
                    contentType: 'text/csv',
                    messageType: 'document',
                });
                continue;
            }

            if (action.type === 'create_excel_file') {
                const name = safeFileName(action.fileName, 'report.xlsx');
                const sheets = Array.isArray(action.sheets) ? action.sheets : [];
                if (!(typeof action.xlsxBase64 === 'string' && action.xlsxBase64.trim().length > 0)) {
                    errors.push(`${name}: OpenCode did not provide xlsxBase64`);
                    continue;
                }
                let excelBuffer: Buffer;
                try {
                    excelBuffer = Buffer.from(action.xlsxBase64.trim(), 'base64');
                } catch {
                    errors.push(`${name}: invalid xlsxBase64 from OpenCode`);
                    continue;
                }

                const finalName = name.endsWith('.xlsx') ? name : `${name}.xlsx`;
                const result = await saveArtifactFile({
                    username,
                    threadId,
                    userApiKey,
                    fileName: finalName,
                    content: excelBuffer,
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                });
                if (!result.success) {
                    errors.push(`${finalName}: ${result.error}`);
                    continue;
                }
                artifacts.push({
                    fileName: finalName,
                    filePath: result.filePath,
                    description: action.description || 'Excel workbook generated by AI tools.',
                    previewText: `Sheets: ${sheets.map((s) => s.name).join(', ')}`,
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    messageType: 'document',
                });
                continue;
            }

            if (action.type === 'create_svg_graph') {
                const name = safeFileName(action.fileName, 'chart.svg');
                if (!(typeof action.svgContent === 'string' && action.svgContent.trim().length > 0)) {
                    errors.push(`${name}: OpenCode did not provide svgContent`);
                    continue;
                }
                const svg = action.svgContent;
                const finalName = name.endsWith('.svg') ? name : `${name}.svg`;
                const result = await saveArtifactFile({
                    username,
                    threadId,
                    userApiKey,
                    fileName: finalName,
                    content: Buffer.from(svg, 'utf-8'),
                    contentType: 'image/svg+xml',
                });
                if (!result.success) {
                    errors.push(`${finalName}: ${result.error}`);
                    continue;
                }
                artifacts.push({
                    fileName: finalName,
                    filePath: result.filePath,
                    description: action.description || 'SVG graph generated by AI tools.',
                    previewText: clampPreview(svg, 1200),
                    contentType: 'image/svg+xml',
                    messageType: 'image',
                });
                continue;
            }

            if (action.type === 'create_canvas_html') {
                const name = safeFileName(action.fileName, 'canvas-chart.html');
                if (!(typeof action.htmlContent === 'string' && action.htmlContent.trim().length > 0)) {
                    errors.push(`${name}: OpenCode did not provide htmlContent`);
                    continue;
                }
                const html = action.htmlContent;
                const finalName = name.endsWith('.html') ? name : `${name}.html`;
                const result = await saveArtifactFile({
                    username,
                    threadId,
                    userApiKey,
                    fileName: finalName,
                    content: Buffer.from(html, 'utf-8'),
                    contentType: 'text/html',
                });
                if (!result.success) {
                    errors.push(`${finalName}: ${result.error}`);
                    continue;
                }
                artifacts.push({
                    fileName: finalName,
                    filePath: result.filePath,
                    description: action.description || 'Canvas HTML chart generated by AI tools.',
                    previewText: clampPreview(html, 1200),
                    contentType: 'text/html',
                    messageType: 'document',
                });
                continue;
            }

            if (action.type === 'edit_text_file') {
                const target = safeFileName(action.targetFileName, '');
                if (!target) {
                    errors.push('edit_text_file: missing targetFileName');
                    continue;
                }
                const existing = await getExistingThreadFileByName({
                    username,
                    threadId,
                    targetFileName: target,
                });
                if (!existing) {
                    errors.push(`edit_text_file: file not found (${target})`);
                    continue;
                }
                const s3Config = getS3Config(userApiKey);
                const fileResult = await getFile({
                    fileName: existing.fileUploadPath,
                    storageType: existing.storageType === 's3' ? 's3' : 'gridfs',
                    s3Config,
                });
                if (!fileResult.success || !fileResult.content) {
                    errors.push(`edit_text_file: failed to read (${target})`);
                    continue;
                }
                const source = fileResult.content.toString('utf-8');
                const updated = applyTextEdit({
                    sourceText: source,
                    mode: action.mode,
                    content: action.content,
                    searchText: action.searchText,
                    replaceWith: action.replaceWith,
                });
                const outName = safeFileName(action.outputFileName || `edited-${target}`, `edited-${target}`);
                const outType = mime.getType(outName) || 'text/plain';
                const saveResult = await saveArtifactFile({
                    username,
                    threadId,
                    userApiKey,
                    fileName: outName,
                    content: Buffer.from(updated, 'utf-8'),
                    contentType: outType,
                });
                if (!saveResult.success) {
                    errors.push(`${outName}: ${saveResult.error}`);
                    continue;
                }
                artifacts.push({
                    fileName: outName,
                    filePath: saveResult.filePath,
                    description: action.description || `Edited from ${target}.`,
                    previewText: clampPreview(updated),
                    contentType: outType,
                    messageType: 'document',
                });
            }
        } catch (error) {
            errors.push(error instanceof Error ? error.message : 'Unknown tool error');
        }
    }

    const summaryParts: string[] = [];
    if (plan.assistantContextNote.trim().length > 0) {
        summaryParts.push(plan.assistantContextNote.trim());
    }
    if (planResult.usedOpencode) {
        summaryParts.push('Artifacts were generated from an OpenCode plan.');
    }
    if (artifacts.length > 0) {
        summaryParts.push(`Created ${artifacts.length} artifact file(s): ${artifacts.map((a) => a.fileName).join(', ')}.`);
    }
    if (errors.length > 0) {
        summaryParts.push(`Some actions failed: ${errors.join(' | ')}`);
    }

    return {
        executed: artifacts.length > 0 || errors.length > 0,
        summary: summaryParts.join(' '),
        artifacts,
    };
}
