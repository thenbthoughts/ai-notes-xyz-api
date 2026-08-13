import path from 'path';
import axios from 'axios';

import { ModelAgentMemory } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelUserApiKey } from '../../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../../utils/llm/llmCommonFunc';
import type { LlmProvider, Message } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { fetchLlmUnifiedLogged } from '../agentUtils/agentWriteLog';
import {
    agentTaskFilesDir,
    getAgentShellConfig,
    shellReadFile,
    shellWriteFile,
} from '../agentUtils/agentShell/agentShellWorkspace';
import {
    AGENT_SHELL_CONTEXT_FILE_LIMIT,
    normalizeAgentShellListing,
    type AgentShellListEntry,
} from '../agentUtils/agentShell/agentShellListing';
import type { AgentToolContext, AgentToolDefinition, AgentToolResult } from './agentToolTypes';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const mimeFromExt = (ext: string): string => {
    switch (ext.toLowerCase()) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.webp':
            return 'image/webp';
        case '.gif':
            return 'image/gif';
        case '.bmp':
            return 'image/bmp';
        case '.tif':
        case '.tiff':
            return 'image/tiff';
        default:
            return 'image/png';
    }
};

const isImagePath = (p: string): boolean => IMAGE_EXTS.has(path.posix.extname(p.replace(/\\/g, '/')).toLowerCase());

const looksLikePath = (s: string): boolean => {
    const t = s.trim();
    if (!t || t.length > 400) return false;
    return /[\\/]/.test(t) || isImagePath(t);
};

export const resolveWorkspaceImagePath = (threadId: string, raw: string): string => {
    const clean = raw
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\.\./g, '')
        .trim();
    if (!clean) {
        throw new Error('empty image path');
    }
    if (clean.startsWith('ai-notes-xyz-shell-files/')) return clean;
    if (clean.startsWith('agent/')) return `ai-notes-xyz-shell-files/${clean}`;
    return `${agentTaskFilesDir(threadId)}/${clean}`;
};

const ocrOutputPath = (threadId: string, imageRel: string): string => {
    const posix = imageRel.replace(/\\/g, '/');
    const agentDir = agentTaskFilesDir(threadId);
    const stem = path.posix.basename(posix).replace(/\.[^.]+$/, '') || 'image';
    const indexIdx = posix.indexOf('/index-data-');
    if (indexIdx !== -1) {
        const after = posix.slice(indexIdx + 1);
        const indexFolder = after.split('/')[0];
        return `${agentDir}/${indexFolder}/converted/${stem}.ocr.txt`;
    }
    if (/\/uploads\//i.test(posix)) {
        return `${agentDir}/${stem}.ocr.txt`;
    }
    const dir = path.posix.dirname(posix);
    return `${dir}/${stem}.ocr.txt`;
};

const pickNewestImage = (entries: AgentShellListEntry[]): AgentShellListEntry | null => {
    const images = entries.filter((e) => !e.isDir && isImagePath(e.relativePath || e.pathInAgentFolder));
    if (!images.length) return null;
    const score = (e: AgentShellListEntry): number => {
        const p = `${e.pathInAgentFolder} ${e.relativePath}`.replace(/\\/g, '/').toLowerCase();
        if (/(^|\/)uploads\//.test(p)) return 2;
        if (/\/index-data-[a-f0-9]+\//.test(p)) return 1;
        return 0;
    };
    return [...images].sort((a, b) => {
        const ds = score(b) - score(a);
        if (ds !== 0) return ds;
        if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
        return (b.size || 0) - (a.size || 0);
    })[0];
};

const listWorkspaceImages = async (
    ctx: AgentToolContext
): Promise<
    | { ok: true; entries: AgentShellListEntry[]; agentShellDir: string }
    | { ok: false; error: string; result: AgentToolResult }
> => {
    const agentShellDir = agentTaskFilesDir(String(ctx.threadId));
    const apiKeyDoc = await ModelUserApiKey.findOne({ userId: ctx.userId });
    if (!apiKeyDoc) {
        return {
            ok: false,
            error: 'api_key_missing',
            result: {
                success: false,
                action: 'image_to_text',
                resultSummary: 'User API key not found',
                error: 'api_key_missing',
            },
        };
    }
    const apiKey = getApiKeyByObject(apiKeyDoc);
    const shell = getAgentShellConfig(apiKey);
    if (!shell) {
        return {
            ok: false,
            error: 'shell_not_configured',
            result: {
                success: false,
                action: 'image_to_text',
                resultSummary: 'Shell Engine is not configured in Settings → API Keys',
                error: 'shell_not_configured',
            },
        };
    }
    const shellRes = await axios.get(`${shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/list`, {
        params: { relativeDir: agentShellDir, maxFiles: 500 },
        timeout: 15_000,
        headers: { 'X-API-Token': shell.token },
        validateStatus: () => true,
    });
    const entries = normalizeAgentShellListing({
        rawFiles:
            shellRes.status === 200 &&
            shellRes.data &&
            Array.isArray((shellRes.data as { files?: unknown }).files)
                ? (shellRes.data as { files: unknown[] }).files
                : [],
        agentShellDir,
        limit: AGENT_SHELL_CONTEXT_FILE_LIMIT,
    });
    return { ok: true, entries, agentShellDir };
};

const argString = (args: Record<string, unknown>, keys: string[]): string => {
    for (const k of keys) {
        const v = args[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
};

export const createImageToTextTool = (): AgentToolDefinition => ({
    name: 'image_to_text',
    description:
        'Read an uploaded workspace image with the LLM (vision OCR). Writes a .ocr.txt sidecar and returns extracted text plus a short description. Prefer this over execute_script/Pillow for OCR.',
    execute: async (ctx, args): Promise<AgentToolResult> => {
        if (!ctx.llmConfig) {
            return {
                success: false,
                action: 'image_to_text',
                resultSummary: 'No LLM config — cannot run vision OCR',
                error: 'llm_config_missing',
            };
        }

        const apiKeyDoc = await ModelUserApiKey.findOne({ userId: ctx.userId });
        if (!apiKeyDoc) {
            return {
                success: false,
                action: 'image_to_text',
                resultSummary: 'User API key not found',
                error: 'api_key_missing',
            };
        }
        const apiKey = getApiKeyByObject(apiKeyDoc);
        const shell = getAgentShellConfig(apiKey);
        if (!shell) {
            return {
                success: false,
                action: 'image_to_text',
                resultSummary: 'Shell Engine is not configured in Settings → API Keys',
                error: 'shell_not_configured',
            };
        }

        const hinted =
            argString(args, ['relativePath', 'imagePath', 'filePath', 'fileName']) ||
            (looksLikePath(argString(args, ['query'])) ? argString(args, ['query']) : '');

        let imageRel = '';
        if (hinted) {
            try {
                imageRel = resolveWorkspaceImagePath(String(ctx.threadId), hinted);
            } catch (e) {
                return {
                    success: false,
                    action: 'image_to_text',
                    resultSummary: e instanceof Error ? e.message : String(e),
                    error: 'bad_path',
                };
            }
        } else {
            const listed = await listWorkspaceImages(ctx);
            if (!listed.ok) return listed.result;
            const newest = pickNewestImage(listed.entries);
            if (!newest) {
                return {
                    success: false,
                    action: 'image_to_text',
                    resultSummary:
                        'No image found in the agent workspace. Upload a png/jpg/webp/gif or pass relativePath.',
                    error: 'image_not_found',
                };
            }
            imageRel = newest.relativePath;
        }

        if (!isImagePath(imageRel)) {
            return {
                success: false,
                action: 'image_to_text',
                resultSummary: `Not an image file: ${imageRel}`,
                error: 'not_an_image',
            };
        }

        let buffer: Buffer;
        try {
            buffer = await shellReadFile({
                shell,
                relativePath: imageRel,
                timeoutMs: 120_000,
                logCtx: ctx.logCtx,
            });
        } catch (e) {
            return {
                success: false,
                action: 'image_to_text',
                resultSummary: `Failed to read image ${imageRel}: ${e instanceof Error ? e.message : String(e)}`,
                error: 'read_failed',
            };
        }

        if (buffer.length > MAX_IMAGE_BYTES) {
            return {
                success: false,
                action: 'image_to_text',
                resultSummary: `Image is ${buffer.length} bytes (max ${MAX_IMAGE_BYTES}). Use a smaller file.`,
                error: 'image_too_large',
            };
        }

        const mime = mimeFromExt(path.posix.extname(imageRel));
        const extra = argString(args, ['query', 'message', 'reason']);
        const extraInstruction =
            extra && !looksLikePath(extra) ? `\n\nExtra instruction from the goal:\n${extra.slice(0, 1500)}` : '';

        const userText =
            `Extract all readable text from this image (OCR). Then give a short description of what the image shows.\n` +
            `If there is no text, say so and describe the image.\n` +
            `Image path: ${imageRel}${extraInstruction}`;

        const messages: Message[] = [
            {
                role: 'system',
                content:
                    'You extract visible text from images (OCR) and briefly describe the picture. Return plain text. Start with the extracted text, then a short "Description:" section.',
            },
            {
                role: 'user',
                content: [
                    { type: 'text', text: userText },
                    {
                        type: 'image_url',
                        image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` },
                    },
                ],
            },
        ];

        const llmResult = await fetchLlmUnifiedLogged({
            logCtx: ctx.logCtx,
            purpose: 'image_to_text',
            params: {
                provider: ctx.llmConfig.provider as LlmProvider,
                apiKey: ctx.llmConfig.apiKey,
                apiEndpoint: ctx.llmConfig.apiEndpoint || '',
                model: ctx.llmConfig.model,
                messages,
                temperature: 0.1,
                maxTokens: 2500,
                headersExtra: ctx.llmConfig.customHeaders,
            },
        });

        if (!llmResult.success || !String(llmResult.content || '').trim()) {
            return {
                success: false,
                action: 'image_to_text',
                resultSummary: `Vision OCR failed: ${llmResult.error || 'empty response'}`,
                error: 'llm_failed',
            };
        }

        const text = String(llmResult.content || '').trim();
        const outRel = ocrOutputPath(String(ctx.threadId), imageRel);
        let writtenPath = outRel;
        try {
            const written = await shellWriteFile({
                shell,
                relativePath: outRel,
                buffer: Buffer.from(text, 'utf8'),
                fileName: path.posix.basename(outRel),
                mimeType: 'text/plain',
                logCtx: ctx.logCtx,
            });
            writtenPath = written.relativePath;
        } catch (e) {
            return {
                success: false,
                action: 'image_to_text',
                resultSummary: `OCR succeeded but failed to write ${outRel}: ${e instanceof Error ? e.message : String(e)}`,
                error: 'write_failed',
                payload: { imagePath: imageRel, text: text.slice(0, 4000) },
            };
        }

        await ModelAgentMemory.create({
            agentInstanceId: ctx.agentInstanceId,
            userId: ctx.userId,
            threadId: ctx.threadId,
            key: `image_to_text_${ctx.tickNumber}`,
            content: `Image: ${imageRel}\nOutput: ${writtenPath}\n\n${text}`.slice(0, 8000),
            memoryType: 'result',
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });

        const { writeUpdate } = await import('./agentToolRegistry');
        await writeUpdate({
            agentInstanceId: ctx.agentInstanceId,
            userId: ctx.userId,
            threadId: ctx.threadId,
            updateType: 'image_to_text',
            message: `OCR ${path.posix.basename(imageRel)} → ${path.posix.basename(writtenPath)}`,
            goalId: ctx.currentGoal._id,
            tickNumber: ctx.tickNumber,
            payload: { imagePath: imageRel, outputPath: writtenPath, textChars: text.length },
        });

        return {
            success: true,
            action: 'image_to_text',
            resultSummary: `OCR ${imageRel} → ${writtenPath}\n\n${text}`.slice(0, 2000),
            payload: { imagePath: imageRel, outputPath: writtenPath, text },
        };
    },
});
