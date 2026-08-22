import {
    AGENT_OPENCODE_ANSWER_FILE,
    AGENT_OPENCODE_CHAT_FILE,
    AGENT_OPENCODE_RUN_TIMEOUT_MS,
    AGENT_OPENCODE_UPLOADS_DIR,
} from '../agentOpencodeConstants';
import {
    agentOpencodeWriteFile,
    type AgentOpencodeShellConfig,
} from '../agentOpencodeWorkspace';
import {
    isOpencodeSessionId as isSessionIdHelper,
    opencodeContainerDirectory,
    opencodeCreateSessionViaShell,
    opencodePromptSessionViaShell,
} from '../agentOpencodeServer';
import type { AgentOpencodePipelinePaths } from './agentOpencodeStepInput';
import { buildUserLibraryMcpContext, type UserLibraryCounts } from '../../../../../utils/mcp/userLibraryCounts';
import type { tsUserApiKey } from '../../../../../utils/llm/llmCommonFunc';

const normalizeForCompare = (value: string): string =>
    value.replace(/\s+/g, ' ').trim().toLowerCase();

const isSameAsPreviousAnswer = (next: string, previous: string): boolean => {
    const a = normalizeForCompare(next);
    const b = normalizeForCompare(previous);
    if (!a || !b) return false;
    if (a === b) return true;
    return a.length > 80 && b.length > 80 && (a.includes(b) || b.includes(a));
};

const isInstructionAck = (value: string): boolean => {
    const n = normalizeForCompare(value);
    if (!n) return true;
    if (n.length < 80) return true;
    if (/instruction\.md/.test(n) && n.length < 400) return true;
    if (/i have read/.test(n) && /follow/.test(n) && n.length < 400) return true;
    if (/will follow it/.test(n) && n.length < 200) return true;
    return false;
};

const isUsableAnswer = (value: string, previous: string): boolean => {
    const text = value.trim();
    if (!text) return false;
    if (isInstructionAck(text)) return false;
    if (isSameAsPreviousAnswer(text, previous)) return false;
    return true;
};

const mimeForFileName = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.md')) return 'text/markdown';
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.csv')) return 'text/csv';
    return 'application/octet-stream';
};

const looksLikeImage = (name: string): boolean => /\.(png|jpe?g|gif|webp|bmp|tiff)$/i.test(name);

const buildNoReplyContext = ({
    uploadedFiles,
    libraryContext,
}: {
    uploadedFiles: string[];
    libraryContext: string;
}): string => {
    const fileLines =
        uploadedFiles.length > 0
            ? uploadedFiles.map((rel) => `- ${rel}`).join('\n')
            : `(none under ${AGENT_OPENCODE_UPLOADS_DIR}/)`;

    const hasImage = uploadedFiles.some((f) => looksLikeImage(f));

    return [
        'Context for this OpenCode session (do not reply to this message).',
        `Working directory is the isolated agent-workspace. Transcript is in ${AGENT_OPENCODE_CHAT_FILE}.`,
        `Uploads are under ${AGENT_OPENCODE_UPLOADS_DIR}/:`,
        fileLines,
        'Use relative paths only. Do not write to / or other absolute roots.',
        `When you answer the next real user message, also write that Markdown answer to ${AGENT_OPENCODE_ANSWER_FILE} for the legacy file fallback.`,
        libraryContext,
        '=== DYNAMIC PROBLEM SOLVING (NO HARDCODING) ===',
        'You must dynamically figure out what the user wants and solve it by writing code, installing packages, and running commands. There is no pre-defined fallback — either solve dynamically or clearly reject.',
        '- Analyze the request, decide what libraries/scripts/commands are needed, and execute via `bash` tool.',
        '- You can write any Node.js script (`write` → `script.js` → `bash: node script.js`) and install any npm package (`npm install <package>`, `npm init -y` if needed).',
        '- You can write any Python script (`write` → `script.py` → `bash: python3 script.py`) and install any pip package (`pip install -q <package>` or `pip install --no-cache-dir <package>`).',
        '- You can run any shell command: `ls`, `cat`, `convert`, `ffmpeg`, `soffice`, `pip`, `npm`, `node`, `python3`, `git`, etc. Use `bash` tool for all execution.',
        '- Common tools already available: ImageMagick (`convert`/`mogrify`) for images, `ffmpeg` for video/audio, `soffice` for office docs; plus any Python/Node library you install (e.g., `pandas`, `openpyxl`, `pillow`, `reportlab`, `exceljs`, `pdf-lib`, `jimp`).',
        '- Do NOT fallback to a hardcoded alternative if a library is missing. Instead, install the required library dynamically and then generate the correct output (e.g., for Excel install `pandas`+`openpyxl`, for images install `pillow` if needed).',
        '- If after attempting you still cannot solve the task, clearly reject the request with an explanation. Do not silently create a wrong format (e.g., do not create CSV when Excel was requested).',
        hasImage ? 'Image processing is AVAILABLE via bash tools (ImageMagick is installed). Use bash to manipulate images:' : '',
        hasImage ? '- List uploads: `ls -lh uploads/`' : '',
        hasImage ? '- Rotate 90° clockwise: `convert "uploads/input.png" -rotate 90 "uploads/rotated_90.png"` (or `mogrify -rotate 90 "uploads/file.png"` to overwrite, but prefer convert to keep original)' : '',
        hasImage ? '- Rotate 180°: `convert "uploads/input.png" -rotate 180 "uploads/rotated_180.png"`' : '',
        hasImage ? '- Python alternative: `python3 -c "from PIL import Image; im=Image.open(\'uploads/input.png\'); im=im.rotate(-90, expand=True); im.save(\'uploads/rotated_90.png\')"` (note PIL rotate is counter-clockwise, so -90 = 90° clockwise)' : '',
        hasImage ? '- After creating the rotated file, verify with `ls -lh uploads/` and mention the new file path in your Markdown answer so the UI can display it.' : '',
        hasImage ? '- Do NOT say you cannot rotate images. You CAN — use the bash tool above.' : '',
        'Do not acknowledge this context message. Wait for the next user message.',
    ]
        .filter((l) => l !== '')
        .join('\n');
};

export const agentOpencodeStepCall = async ({
    promptText,
    historyMarkdown,
    uploadedFiles,
    shell,
    paths,
    apiKeys,
    model,
    sessionId,
    sessionTitle,
    libraryCounts,
    previousAnswerText,
}: {
    promptText: string;
    historyMarkdown: string;
    uploadedFiles: string[];
    shell: AgentOpencodeShellConfig;
    paths: AgentOpencodePipelinePaths;
    apiKeys: tsUserApiKey;
    model: { providerID: string; modelID: string; cliModel: string };
    sessionId?: string;
    sessionTitle?: string;
    libraryCounts: UserLibraryCounts;
    previousAnswerText?: string;
}): Promise<{ text: string; sessionId: string }> => {
    const prior = (previousAnswerText || '').trim();
    const containerDir = opencodeContainerDirectory(paths.agentWorkspaceDir);

    if (!shell?.baseUrl || !shell?.token) {
        throw new Error(
            'Agent Workspace is not configured. Add a valid Agent Workspace API URL and token in Settings → Agent Workspace. Opencode is accessed via the workspace container (localhost:4096 inside container).'
        );
    }

    try {
        const instructionFallback = [
            `Working directory is the isolated agent-workspace folder (${containerDir}).`,
            `Chat transcript is also in ${AGENT_OPENCODE_CHAT_FILE}.`,
            `Attached files: ${uploadedFiles.length ? uploadedFiles.join(', ') : '(none)'}`,
            `Model: ${model.providerID}/${model.modelID}`,
            `User message:\n${promptText}`,
        ].join('\n\n');
        await agentOpencodeWriteFile({
            shell,
            relativePath: paths.instructionFile,
            buffer: Buffer.from(`${instructionFallback}\n`, 'utf8'),
            mimeType: 'text/markdown',
        });
        await agentOpencodeWriteFile({
            shell,
            relativePath: `${paths.agentWorkspaceDir}/${AGENT_OPENCODE_ANSWER_FILE}`,
            buffer: Buffer.from('', 'utf8'),
            mimeType: 'text/markdown',
        });
    } catch {
        // ignore
    }

    const libraryContext = buildUserLibraryMcpContext(libraryCounts);

    const fileParts: Array<{ type: 'file'; mime: string; url: string; filename?: string }> = [];
    for (const rel of uploadedFiles) {
        const absolute = `${containerDir}/${rel}`.replace(/\\/g, '/');
        const filename = rel.split('/').pop() || 'file';
        fileParts.push({
            type: 'file',
            mime: mimeForFileName(filename),
            url: `file://${absolute}`,
            filename,
        });
    }

    const ensureSession = async (existing: string): Promise<string> => {
        const trimmed = String(existing || '').trim();
        if (trimmed && isSessionIdHelper(trimmed)) return trimmed;
        const title = String(sessionTitle || '').trim().slice(0, 80) || 'AI Notes';
        const created = await opencodeCreateSessionViaShell({
            shell,
            directory: containerDir,
            title,
            timeoutMs: 30_000,
        });
        return created.sessionId;
    };

    const promptWithSession = async (
        sid: string,
        text: string,
        extraFileParts: typeof fileParts,
        opts?: { noReply?: boolean }
    ): Promise<{ text: string; sessionId: string }> => {
        const parts: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }> = [];
        if (text.trim()) {
            parts.push({ type: 'text', text: text.trim() });
        } else {
            parts.push({ type: 'text', text: '(empty prompt)' });
        }
        if (!opts?.noReply) {
            for (const fp of extraFileParts) parts.push(fp);
        }
        const result = await opencodePromptSessionViaShell({
            shell,
            directory: containerDir,
            sessionId: sid,
            model: { providerID: model.providerID, modelID: model.modelID },
            parts,
            noReply: opts?.noReply,
            timeoutMs: AGENT_OPENCODE_RUN_TIMEOUT_MS,
        });
        return { text: result.text, sessionId: result.sessionId };
    };

    let resolvedSessionId = String(sessionId || '').trim();
    if (!resolvedSessionId || !isSessionIdHelper(resolvedSessionId)) {
        resolvedSessionId = await ensureSession('');
    }

    const needsContextSeed = Boolean(libraryContext.trim() || uploadedFiles.length > 0);
    let contextSeeded = false;
    if (needsContextSeed) {
        try {
            const ctxText = buildNoReplyContext({ uploadedFiles, libraryContext });
            await promptWithSession(resolvedSessionId, ctxText, [], { noReply: true });
            contextSeeded = true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/not found|404/i.test(msg)) {
                resolvedSessionId = await ensureSession('');
                try {
                    const ctxText = buildNoReplyContext({ uploadedFiles, libraryContext });
                    await promptWithSession(resolvedSessionId, ctxText, [], { noReply: true });
                    contextSeeded = true;
                } catch {
                    // ignore
                }
            }
        }
    }

    const runRealPrompt = async (sid: string): Promise<{ text: string; sessionId: string }> => {
        return promptWithSession(sid, promptText, fileParts, { noReply: false });
    };

    let result: { text: string; sessionId: string };
    try {
        result = await runRealPrompt(resolvedSessionId);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not found|404|session/i.test(msg)) {
            resolvedSessionId = await ensureSession('');
            if (historyMarkdown.trim()) {
                const historySnippet = historyMarkdown.slice(0, 6000);
                try {
                    await promptWithSession(resolvedSessionId, `Prior chat history (for context only, do not reply):\n\n${historySnippet}`, [], {
                        noReply: true,
                    });
                } catch {
                    // ignore
                }
            }
            if (!contextSeeded && needsContextSeed) {
                try {
                    await promptWithSession(
                        resolvedSessionId,
                        buildNoReplyContext({ uploadedFiles, libraryContext }),
                        [],
                        { noReply: true }
                    );
                } catch {
                    // ignore
                }
            }
            result = await runRealPrompt(resolvedSessionId);
        } else {
            throw err;
        }
    }

    let text = result.text.trim();
    let finalSessionId = result.sessionId || resolvedSessionId;

    if (!isUsableAnswer(text, prior)) {
        const newSid = await ensureSession('');
        if (historyMarkdown.trim()) {
            const historySnippet = historyMarkdown.slice(0, 6000);
            try {
                await promptWithSession(newSid, `Prior chat history (for context only):\n\n${historySnippet}`, [], { noReply: true });
            } catch {
                // ignore
            }
        }
        try {
            const retry = await runRealPrompt(newSid);
            const retryText = retry.text.trim();
            if (isUsableAnswer(retryText, prior)) {
                text = retryText;
                finalSessionId = retry.sessionId || newSid;
            } else {
                finalSessionId = retry.sessionId || newSid;
                text = retryText;
            }
        } catch (retryErr) {
            throw retryErr;
        }
    }

    if (!isUsableAnswer(text, prior)) {
        const snippet = text.slice(0, 800) || 'OpenCode returned empty output';
        throw new Error(`OpenCode did not return an answer. ${snippet}`);
    }

    return { text, sessionId: finalSessionId };
};

export default agentOpencodeStepCall;