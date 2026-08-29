import {
    AGENT_OPENCODE_ANSWER_FILE,
    AGENT_OPENCODE_CHAT_FILE,
    AGENT_OPENCODE_MAX_ANSWER_TIME_MS,
    AGENT_OPENCODE_RUN_TIMEOUT_MS,
    AGENT_OPENCODE_UPLOADS_DIR,
} from '../agentOpencodeConstants';
import type { AgentOpencodeShellConfig } from '../agentOpencodeWorkspace';
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

    return [
        'Context for this OpenCode session (do not reply to this message).',
        `Working directory is the isolated thread root (contains CHAT.md, ANSWER.md, uploads/). Transcript is in ${AGENT_OPENCODE_CHAT_FILE}.`,
        `Uploads are under ${AGENT_OPENCODE_UPLOADS_DIR}/:`,
        fileLines,
        'Use relative paths only. Do not write to / or other absolute roots. Tool installs (npm, pip) happen in the same thread root.',
        `When you answer the next real user message, also write that Markdown answer to ${AGENT_OPENCODE_ANSWER_FILE} (cleared each turn) for the thread output.`,
        libraryContext,
        '=== DYNAMIC PROBLEM SOLVING (NO HARDCODING) ===',
        'You must dynamically figure out what the user wants and solve it by writing code, installing packages, and running commands. There is no pre-defined fallback — either solve dynamically or clearly reject.',
        '- Analyze the request, decide what libraries/scripts/commands are needed, and execute via `bash` tool.',
        '- You can write any Node.js script (`write` → `script.js` → `bash: node script.js`) and install any npm package (`npm install <package>`, `npm init -y` if needed).',
        '- You can write any Python script (`write` → `script.py` → `bash: python3 script.py`) and install any pip package (`pip install -q <package>` or `pip install --no-cache-dir <package>`).',
        '- You can run any shell command: `ls`, `cat`, `convert`, `ffmpeg`, `soffice`, `pip`, `npm`, `node`, `python3`, `git`, etc. Use `bash` tool for all execution.',
        '- Available tools (decide yourself what fits the request): ImageMagick `convert`/`mogrify` for images (e.g., `convert "uploads/input.png" -rotate 90 "uploads/output.png"` or Python `PIL` `pillow`), `ffmpeg` for video/audio, `soffice` for office docs; plus any Python/Node library you install (e.g., `pandas`+`openpyxl` for Excel, `reportlab` for PDF, `exceljs`, `pdf-lib`, `jimp`).',
        '- Do NOT fallback to a hardcoded alternative if a library is missing. Instead, install the required library dynamically and then generate the correct output (e.g., for Excel install `pandas`+`openpyxl`, for images install `pillow` if needed).',
        '- If after attempting you still cannot solve the task, clearly reject the request with an explanation. Do not silently create a wrong format (e.g., do not create CSV when Excel was requested).',
        '- After creating any file, always verify with `ls -lh <path>` and mention the new file path in your Markdown answer so the UI can show it.',
        '- Do NOT say you lack a capability that a tool above provides — if a tool exists, use bash to run it.',
        '- Privacy for external tools: `webfetch` and random websites/APIs are external and may leak data. If the request or uploads look like PII (names, emails, IDs, health, finance, location, biometrics) or private non-common info (personal notes, vault ideas, not common knowledge), do NOT use `webfetch` or external APIs. Find a local alternative via bash (`convert`, `pillow`, `pandas`, `ffmpeg`, `soffice`, `node`/`python`) or clearly reject and say what you tried and why.',
        '- LLM providers you configured (Groq, OpenRouter, OpenAI, Ollama, LocalAI) are trusted and may be used for PII.',
        '- Only use an external website for PII if the user explicitly says it is fine (e.g., "yes, it is fine to use external tools" or "yes, use web search for this"). If unsure, ask: "This looks private — do you want me to use an external website for this? Say yes and I will proceed, otherwise I can do it locally with [tool]."',
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
    maxAnswerTimeMinutes,
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
    maxAnswerTimeMinutes?: number;
    libraryCounts: UserLibraryCounts;
    previousAnswerText?: string;
}): Promise<{ text: string; sessionId: string }> => {
    const prior = (previousAnswerText || '').trim();
    const containerDir = opencodeContainerDirectory(paths.agentWorkspaceDir);
    const answerTimeMinutes =
        typeof maxAnswerTimeMinutes === 'number' && maxAnswerTimeMinutes > 0 ? Math.round(maxAnswerTimeMinutes) : 60;
    const maxAnswerTimeMs = Math.min(
        Math.max(answerTimeMinutes * 60_000, 1),
        AGENT_OPENCODE_MAX_ANSWER_TIME_MS
    );

    if (!shell?.baseUrl || !shell?.token) {
        throw new Error(
            'Agent Workspace is not configured. Add a valid Agent Workspace API URL and token in Settings → Agent Workspace. Opencode is accessed via the workspace container (localhost:4096 inside container).'
        );
    }

    // No legacy INSTRUCTION.md write — prompt goes via API, history is in CHAT.md.
    // ANSWER.md is already cleared in agentOpencodeStepInput (per-thread, per-message).

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
        opts?: { noReply?: boolean; timeoutMs?: number }
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
            timeoutMs: opts?.timeoutMs ?? AGENT_OPENCODE_RUN_TIMEOUT_MS,
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
        return promptWithSession(sid, promptText, fileParts, { noReply: false, timeoutMs: maxAnswerTimeMs });
    };

    let result: { text: string; sessionId: string };
    try {
        result = await runRealPrompt(resolvedSessionId);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Retry on session not found *or* UnknownError (often missing provider / bad directory)
        if (/not found|404|session|UnknownError|Unexpected server error/i.test(msg)) {
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
        const snippet = text.slice(0, 800) || '(empty)';
        let reason = 'empty or unusable';
        if (!text.trim()) {
            reason = 'empty answer (no text returned)';
        } else if (isInstructionAck(text)) {
            reason = 'looks like an instruction ack or short reply <80 chars';
        } else if (isSameAsPreviousAnswer(text, prior)) {
            reason = 'duplicate of previous answer';
        }
        const promptPreview = promptText.replace(/\s+/g, ' ').trim().slice(0, 120) || '(empty prompt)';
        const tried = `tried: seed context (${contextSeeded ? 'sent' : 'skipped'}) -> prompt "${promptPreview}" -> session ${finalSessionId}`;
        throw new Error(
            `OpenCode did not return a usable answer. ${tried}. Returned: "${snippet}". Rejected because: ${reason}. Suggestion: rephrase with an explicit output path like "create uploads/output.xlsx" or check that uploads/ contains the expected file, then retry.`
        );
    }

    return { text, sessionId: finalSessionId };
};

export default agentOpencodeStepCall;