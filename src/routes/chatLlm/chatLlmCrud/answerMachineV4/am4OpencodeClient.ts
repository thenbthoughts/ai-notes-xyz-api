import { AM4_OPENCODE_DEFAULT_EXECUTOR_MODEL, AM4_OPENCODE_EXECUTOR_AGENT } from './am4OpencodeConstants';

export async function createAm4OpencodeClient(baseUrl: string, username: string, password: string) {
    const importOpencodeSdk = new Function('return import("@opencode-ai/sdk/v2");') as () => Promise<
        typeof import('@opencode-ai/sdk/v2')
    >;
    const { createOpencodeClient } = await importOpencodeSdk();
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    return createOpencodeClient({
        baseUrl: baseUrl.replace(/\/+$/, ''),
        headers: {
            Authorization: `Basic ${auth}`,
        },
    });
}

export type Am4OpencodeModel = { providerID: string; modelID: string };

export function extractTextFromOpencodeParts(parts: unknown[] | undefined): string {
    if (!Array.isArray(parts)) {
        return '';
    }
    const chunks: string[] = [];
    for (const p of parts) {
        if (!p || typeof p !== 'object' || !('type' in p)) {
            continue;
        }
        const typ = (p as { type?: string }).type;
        if (typ === 'text' || typ === 'reasoning') {
            const text = (p as { text?: unknown }).text;
            if (typeof text === 'string' && text) {
                chunks.push(text);
            }
        }
    }
    return chunks.join('\n').trim();
}

/** Ingest NDJSON for Cursor debug sessions (folded). */
function am4DebugLog(location: string, message: string, data: Record<string, unknown>, hypothesisId: string) {
    // #region agent log
    fetch('http://127.0.0.1:7570/ingest/42952f8c-d210-41f0-861b-68e54358b712', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6a1c03' },
        body: JSON.stringify({
            sessionId: '6a1c03',
            location,
            message,
            data,
            timestamp: Date.now(),
            hypothesisId,
        }),
    }).catch(() => {});
    // #endregion
}

/**
 * Registers the user's OpenRouter API key on the OpenCode instance (`PUT /auth/openrouter` style).
 * Key comes from user schema via thread `getLlmConfig`; never log the key.
 */
export async function syncAm4OpencodeProviderCredentials(
    client: Awaited<ReturnType<typeof createAm4OpencodeClient>>,
    llmConfig: { provider: string; apiKey: string },
): Promise<void> {
    const key = llmConfig.apiKey?.trim();
    if (!key || llmConfig.provider !== 'openrouter') {
        return;
    }
    const res = await client.auth.set({
        providerID: 'openrouter',
        auth: { type: 'api', key },
    });
    // #region agent log
    {
        const rr = res as { error?: unknown; response?: Response };
        am4DebugLog('am4OpencodeClient.ts:sync-openrouter-auth', 'auth.set openrouter', {
            runId: 'post-fix',
            hasError: !!res.error,
            httpStatus: typeof rr.response?.status === 'number' ? rr.response.status : undefined,
        }, 'H11');
    }
    // #endregion
}

function summarizeSdkErrorForDebug(err: unknown): string {
    if (err == null) {
        return '';
    }
    if (typeof err === 'string') {
        return err.slice(0, 400);
    }
    if (typeof err === 'object' && err !== null && 'message' in err) {
        const m = (err as { message?: unknown }).message;
        if (typeof m === 'string') {
            return m.slice(0, 400);
        }
    }
    try {
        return JSON.stringify(err).slice(0, 400);
    } catch {
        return 'unserializable-error';
    }
}

function summarizeOpencodePartsForDebug(parts: unknown[] | undefined): { types: string[]; textLenReasoningOnly: number } {
    const types: string[] = [];
    let reasoningLen = 0;
    if (!Array.isArray(parts)) {
        return { types: [], textLenReasoningOnly: 0 };
    }
    for (const p of parts) {
        const t = p && typeof p === 'object' && 'type' in p ? String((p as { type?: unknown }).type) : '?';
        types.push(t);
        if (t === 'reasoning' && p && typeof p === 'object' && 'text' in p) {
            const tx = (p as { text?: unknown }).text;
            if (typeof tx === 'string') {
                reasoningLen += tx.length;
            }
        }
    }
    return { types, textLenReasoningOnly: reasoningLen };
}

const AM4_V1_POLL_INTERVAL_MS = 400;
const AM4_V1_POLL_MAX_MS = 120_000;

/** OpenCode may return `session.prompt` body as `{info,parts}`, as a non-empty array of those, or as `[]` (truthy but empty). */
function normalizeSessionPromptEnvelope(data: unknown): { parts?: unknown[]; info?: unknown } | null {
    if (data == null) {
        return null;
    }
    if (Array.isArray(data)) {
        if (data.length === 0) {
            return null;
        }
        const last = data[data.length - 1];
        if (last && typeof last === 'object') {
            return last as { parts?: unknown[]; info?: unknown };
        }
        return null;
    }
    if (typeof data === 'object') {
        return data as { parts?: unknown[]; info?: unknown };
    }
    return null;
}

function extractTextFromToolStateContent(content: unknown, out: string[]): void {
    if (!Array.isArray(content)) {
        return;
    }
    for (const c of content) {
        if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') {
            const text = (c as { text?: unknown }).text;
            if (typeof text === 'string' && text.trim()) {
                out.push(text);
            }
        }
    }
}

/** Latest assistant text from OpenCode v2 timeline (`session.context` or `v2.session.messages` items). */
function extractAssistantTextFromV2Context(msgs: unknown): string {
    if (!Array.isArray(msgs) || msgs.length === 0) {
        return '';
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!m || typeof m !== 'object') {
            continue;
        }
        if ((m as { type?: string }).type !== 'assistant') {
            continue;
        }
        const content = (m as { content?: unknown }).content;
        if (!Array.isArray(content)) {
            continue;
        }
        const parts: string[] = [];
        for (const block of content) {
            if (!block || typeof block !== 'object' || !('type' in block)) {
                continue;
            }
            const kind = (block as { type: string }).type;
            if (kind === 'text' || kind === 'reasoning') {
                const text = (block as { text?: unknown }).text;
                if (typeof text === 'string' && text.trim()) {
                    parts.push(text);
                }
            } else if (kind === 'tool') {
                const state = (block as { state?: unknown }).state;
                if (!state || typeof state !== 'object' || !('status' in state)) {
                    continue;
                }
                const status = (state as { status: string }).status;
                if (status === 'pending' && 'input' in state) {
                    const inp = (state as { input: unknown }).input;
                    if (typeof inp === 'string' && inp.trim()) {
                        parts.push(inp);
                    }
                } else if ('content' in state) {
                    extractTextFromToolStateContent((state as { content: unknown }).content, parts);
                }
            }
        }
        const joined = parts.join('\n').trim();
        if (joined) {
            return joined;
        }
    }
    return '';
}

/** After a successful v2 `prompt`, block on `wait` then read `context` / `messages`. */
async function tryCollectFromV2AfterWait(
    client: Awaited<ReturnType<typeof createAm4OpencodeClient>>,
    sessionID: string,
    logPrefix: string
): Promise<string> {
    const waitV2 = await client.v2.session.wait({ sessionID });
    const resW = waitV2 as { response?: Response };
    // #region agent log
    am4DebugLog(`am4OpencodeClient.ts:${logPrefix}-v2-wait`, 'v2 session wait', {
        runId: 'post-fix',
        hasError: !!waitV2.error,
        httpStatus: typeof resW.response?.status === 'number' ? resW.response.status : undefined,
    }, 'H9');
    // #endregion
    if (waitV2.error) {
        return '';
    }
    const ctxRes = await client.v2.session.context({ sessionID });
    const ctxLen = Array.isArray(ctxRes.data) ? ctxRes.data.length : -1;
    // #region agent log
    am4DebugLog(`am4OpencodeClient.ts:${logPrefix}-v2-ctx`, 'v2 context', {
        runId: 'post-fix',
        ctxLen,
        ctxErr: !!ctxRes.error,
    }, 'H9');
    // #endregion
    if (!ctxRes.error && Array.isArray(ctxRes.data)) {
        const t = extractAssistantTextFromV2Context(ctxRes.data);
        if (t.trim()) {
            return t;
        }
    }
    const v2m = await client.v2.session.messages({ sessionID });
    const items =
        v2m.data && typeof v2m.data === 'object' && 'items' in v2m.data
            ? (v2m.data as { items: unknown }).items
            : null;
    const itemLen = Array.isArray(items) ? items.length : -1;
    // #region agent log
    am4DebugLog(`am4OpencodeClient.ts:${logPrefix}-v2-items`, 'v2 messages items', {
        runId: 'post-fix',
        itemLen,
        v2Err: !!v2m.error,
    }, 'H9');
    // #endregion
    if (!v2m.error && Array.isArray(items)) {
        const t = extractAssistantTextFromV2Context(items);
        return t.trim() ? t : '';
    }
    return '';
}

/**
 * `prompt_async` may update the v2 timeline while v1 `session.messages` stays user-only (see debug logs).
 * Wait on v2 idle, then poll v2 context/messages and v1 messages until text or timeout.
 */
async function waitForAssistantTextViaV1SessionMessages(params: {
    client: Awaited<ReturnType<typeof createAm4OpencodeClient>>;
    sessionID: string;
}): Promise<string> {
    const { client, sessionID } = params;
    const deadline = Date.now() + AM4_V1_POLL_MAX_MS;
    let attempts = 0;

    try {
        const waitV2 = await client.v2.session.wait({ sessionID });
        const resW = waitV2 as { error?: unknown; response?: Response };
        // #region agent log
        am4DebugLog('am4OpencodeClient.ts:v2-wait-before-poll', 'v2 session wait before poll loop', {
            runId: 'post-fix',
            hasError: !!waitV2.error,
            httpStatus: typeof resW.response?.status === 'number' ? resW.response.status : undefined,
        }, 'H8');
        // #endregion
    } catch (e) {
        // #region agent log
        am4DebugLog('am4OpencodeClient.ts:v2-wait-before-poll', 'v2 wait threw', {
            runId: 'post-fix',
            message: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
        }, 'H8');
        // #endregion
    }

    while (Date.now() < deadline) {
        attempts += 1;

        if (attempts === 1 || attempts % 5 === 0) {
            try {
                const ctxRes = await client.v2.session.context({ sessionID });
                const ctxArr = Array.isArray(ctxRes.data) ? ctxRes.data : [];
                if (attempts === 1 || attempts % 25 === 0) {
                    // #region agent log
                    am4DebugLog('am4OpencodeClient.ts:v2-context-during-poll', 'v2 context during poll', {
                        runId: 'post-fix',
                        attempts,
                        ctxLen: ctxArr.length,
                        ctxErr: !!ctxRes.error,
                    }, 'H8');
                    // #endregion
                }
                if (!ctxRes.error && ctxArr.length > 0) {
                    const tV2 = extractAssistantTextFromV2Context(ctxRes.data);
                    if (tV2.trim()) {
                        // #region agent log
                        am4DebugLog('am4OpencodeClient.ts:v2-wait-assistant', 'text from v2 context', {
                            runId: 'post-fix',
                            attempts,
                            textLen: tV2.length,
                        }, 'poll');
                        // #endregion
                        return tV2;
                    }
                }
                const v2m = await client.v2.session.messages({ sessionID });
                const items =
                    v2m.data && typeof v2m.data === 'object' && 'items' in v2m.data
                        ? (v2m.data as { items: unknown }).items
                        : null;
                const itemLen = Array.isArray(items) ? items.length : -1;
                if (attempts === 1 || attempts % 25 === 0) {
                    // #region agent log
                    am4DebugLog('am4OpencodeClient.ts:v2-messages-during-poll', 'v2 messages during poll', {
                        runId: 'post-fix',
                        attempts,
                        itemLen,
                        v2Err: !!v2m.error,
                    }, 'H8');
                    // #endregion
                }
                if (!v2m.error && Array.isArray(items) && items.length > 0) {
                    const tM = extractAssistantTextFromV2Context(items);
                    if (tM.trim()) {
                        // #region agent log
                        am4DebugLog('am4OpencodeClient.ts:v2-wait-assistant', 'text from v2 messages items', {
                            runId: 'post-fix',
                            attempts,
                            textLen: tM.length,
                        }, 'poll');
                        // #endregion
                        return tM;
                    }
                }
            } catch (e) {
                if (attempts === 1) {
                    // #region agent log
                    am4DebugLog('am4OpencodeClient.ts:v2-poll-error', 'v2 context/messages threw', {
                        runId: 'post-fix',
                        message: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
                    }, 'H8');
                    // #endregion
                }
            }
        }

        const listRes = await client.session.messages({ sessionID });
        if (listRes.error || !Array.isArray(listRes.data)) {
            await new Promise<void>((resolve) => {
                setTimeout(resolve, AM4_V1_POLL_INTERVAL_MS);
            });
            continue;
        }
        const rows = listRes.data as Array<{ info?: { id?: string; role?: string }; parts?: unknown[] }>;
        if (attempts === 1) {
            // #region agent log
            am4DebugLog('am4OpencodeClient.ts:v1-messages-snapshot', 'messages list snapshot', {
                runId: 'post-fix',
                messagesListLen: rows.length,
                roles: rows.map((r) =>
                    r.info && typeof r.info === 'object' && 'role' in r.info
                        ? String((r.info as { role?: unknown }).role)
                        : '?'
                ),
                hasId: rows.map(
                    (r) =>
                        !!(r.info && typeof r.info === 'object' && typeof (r.info as { id?: unknown }).id === 'string')
                ),
            }, 'poll');
            // #endregion
        }
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            const role = row?.info?.role;
            if (role === 'user') {
                continue;
            }
            const fromList = extractTextFromOpencodeParts(row.parts);
            if (fromList.trim()) {
                // #region agent log
                am4DebugLog('am4OpencodeClient.ts:v1-wait-assistant', 'text from messages list row parts', {
                    runId: 'post-fix',
                    attempts,
                    textLen: fromList.length,
                    rowRole: role ?? 'missing',
                }, 'poll');
                // #endregion
                return fromList;
            }
        }
        let assistantId: string | null = null;
        for (let i = rows.length - 1; i >= 0; i--) {
            const info = rows[i]?.info;
            if (
                info &&
                typeof info === 'object' &&
                typeof info.id === 'string' &&
                info.id.length > 0 &&
                info.role !== 'user'
            ) {
                assistantId = info.id;
                break;
            }
        }
        if (!assistantId) {
            if (attempts === 1 || attempts % 25 === 0) {
                // #region agent log
                am4DebugLog('am4OpencodeClient.ts:v1-wait-assistant', 'no assistant row yet', {
                    runId: 'post-fix',
                    attempts,
                    messagesListLen: rows.length,
                }, 'poll');
                // #endregion
            }
            await new Promise<void>((resolve) => {
                setTimeout(resolve, AM4_V1_POLL_INTERVAL_MS);
            });
            continue;
        }
        const msgRes = await client.session.message({
            sessionID,
            messageID: assistantId,
        });
        if (msgRes.error || !msgRes.data) {
            // #region agent log
            am4DebugLog('am4OpencodeClient.ts:v1-wait-assistant', 'session.message error', {
                runId: 'post-fix',
                attempts,
                hasError: !!msgRes.error,
            }, 'poll');
            // #endregion
            await new Promise<void>((resolve) => {
                setTimeout(resolve, AM4_V1_POLL_INTERVAL_MS);
            });
            continue;
        }
        const data = msgRes.data as { parts?: unknown[]; info?: unknown };
        const t = extractTextFromOpencodeParts(data.parts);
        if (t.trim()) {
            // #region agent log
            am4DebugLog('am4OpencodeClient.ts:v1-wait-assistant', 'poll got assistant text', {
                runId: 'post-fix',
                attempts,
                textLen: t.length,
            }, 'poll');
            // #endregion
            return t;
        }
        const info = data.info;
        if (info && typeof info === 'object' && 'error' in info && (info as { error?: unknown }).error) {
            // #region agent log
            am4DebugLog('am4OpencodeClient.ts:v1-wait-assistant', 'assistant message has error field', {
                runId: 'post-fix',
                attempts,
            }, 'poll');
            // #endregion
            break;
        }
        if (
            info &&
            typeof info === 'object' &&
            'role' in info &&
            (info as { role?: string }).role === 'assistant' &&
            'time' in info &&
            typeof (info as { time?: { completed?: number } }).time?.completed === 'number'
        ) {
            // #region agent log
            am4DebugLog('am4OpencodeClient.ts:v1-wait-assistant', 'assistant completed but no extractable text', {
                runId: 'post-fix',
                attempts,
                partTypes: summarizeOpencodePartsForDebug(data.parts).types,
            }, 'poll');
            // #endregion
            break;
        }
        await new Promise<void>((resolve) => {
            setTimeout(resolve, AM4_V1_POLL_INTERVAL_MS);
        });
    }
    return '';
}

/**
 * Many OpenCode hosts run the agent off **v2** `POST /api/session/{id}/prompt`; v1 `prompt_async` can return 204
 * while v1/v2 timelines stay empty. Try **v2 prompt first**; only if it errors, use `prompt_async` + v1 sync fallback.
 */
export async function runAm4SessionPromptAndCollectAssistant(params: {
    client: Awaited<ReturnType<typeof createAm4OpencodeClient>>;
    sessionID: string;
    promptBody: string;
    system: string;
    model?: Am4OpencodeModel;
    /** Whether `model` came from thread LLM mapping or AM4 fallback. */
    executorModelSource?: 'thread' | 'default';
    /** Thread `llmConfig.model` before OpenCode-specific normalization (debug only). */
    threadLlmModelRaw?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    const { client, sessionID, promptBody, system, model, executorModelSource, threadLlmModelRaw } = params;

    const executorModel = model ?? {
        providerID: AM4_OPENCODE_DEFAULT_EXECUTOR_MODEL.providerID,
        modelID: AM4_OPENCODE_DEFAULT_EXECUTOR_MODEL.modelID,
    };

    // #region agent log
    am4DebugLog('am4OpencodeClient.ts:executor-config', 'OpenCode executor v1 payload config', {
        runId: 'post-fix',
        agent: AM4_OPENCODE_EXECUTOR_AGENT,
        providerID: executorModel.providerID,
        modelID: executorModel.modelID,
        modelSource: executorModelSource ?? 'default',
        threadLlmModelRaw: threadLlmModelRaw ?? '',
    }, 'H10');
    // #endregion

    const promptBodyPayload = {
        sessionID,
        system,
        agent: AM4_OPENCODE_EXECUTOR_AGENT,
        parts: [{ type: 'text' as const, text: promptBody }],
        model: { providerID: executorModel.providerID, modelID: executorModel.modelID },
    };

    const combinedV2Text = `${system}\n\n${promptBody}`;
    const v2FirstRes = await client.v2.session.prompt({
        sessionID,
        prompt: { text: combinedV2Text },
        delivery: 'immediate',
    });

    // #region agent log
    {
        const res = v2FirstRes as { error?: unknown; response?: Response };
        am4DebugLog('am4OpencodeClient.ts:v2-prompt-first', 'v2 /api/session/.../prompt (first)', {
            runId: 'post-fix',
            hasError: !!v2FirstRes.error,
            httpStatus: typeof res.response?.status === 'number' ? res.response.status : undefined,
            v2ErrorSummary: summarizeSdkErrorForDebug(v2FirstRes.error),
        }, 'H9');
    }
    // #endregion

    let usedV2Prompt = false;
    if (!v2FirstRes.error) {
        usedV2Prompt = true;
        const fromV2 = await tryCollectFromV2AfterWait(client, sessionID, 'v2first');
        if (fromV2.trim()) {
            // #region agent log
            am4DebugLog('am4OpencodeClient.ts:v2-first-got-text', 'v2-first path returned text', {
                runId: 'post-fix',
                textLen: fromV2.length,
            }, 'H9');
            // #endregion
            return { ok: true, text: fromV2 };
        }
    }

    let immediateText = '';

    if (!usedV2Prompt) {
        const asyncRes = await client.session.promptAsync(promptBodyPayload);

        // #region agent log
        {
            const res = asyncRes as { error?: unknown; response?: Response };
            am4DebugLog('am4OpencodeClient.ts:after-prompt-async', 'prompt_async finished', {
                runId: 'post-fix',
                hasError: !!asyncRes.error,
                httpStatus: typeof res.response?.status === 'number' ? res.response.status : undefined,
            }, 'H7');
        }
        // #endregion

        if (asyncRes.error) {
            const res = asyncRes as { error?: unknown; response?: Response };
            const st = typeof res.response?.status === 'number' ? res.response.status : 0;
            if (st === 404 || st === 405 || st === 501) {
                const promptRes = await client.session.prompt(promptBodyPayload);
                // #region agent log
                {
                    const raw = promptRes.data;
                    const envelope = normalizeSessionPromptEnvelope(raw);
                    const pdata = envelope;
                    const partDbg = summarizeOpencodePartsForDebug(pdata?.parts);
                    const rawShape =
                        raw == null
                            ? 'null'
                            : Array.isArray(raw)
                              ? `array:${raw.length}`
                              : typeof raw === 'object'
                                ? `object:${Object.keys(raw as object).length}keys`
                                : typeof raw;
                    am4DebugLog('am4OpencodeClient.ts:after-v1-prompt', 'v1 sync prompt fallback', {
                        sessionIdLen: sessionID.length,
                        hasError: !!promptRes.error,
                        hasData: !!promptRes.data,
                        rawShape,
                        partTypes: partDbg.types,
                        reasoningChars: partDbg.textLenReasoningOnly,
                        extractedTextChars: extractTextFromOpencodeParts(pdata?.parts).length,
                        infoRole:
                            pdata?.info && typeof pdata.info === 'object' && 'role' in pdata.info
                                ? String((pdata.info as { role?: unknown }).role)
                                : 'missing',
                        hasStringInfoId:
                            pdata?.info &&
                            typeof pdata.info === 'object' &&
                            'id' in pdata.info &&
                            typeof (pdata.info as { id?: unknown }).id === 'string',
                        infoCompleted:
                            pdata?.info && typeof pdata.info === 'object'
                                ? (pdata.info as { completed?: unknown }).completed
                                : undefined,
                    }, 'H1');
                }
                // #endregion
                if (promptRes.error || !promptRes.data) {
                    const msg =
                        promptRes.error && typeof promptRes.error === 'object' && 'message' in promptRes.error
                            ? String((promptRes.error as { message?: unknown }).message)
                            : 'OpenCode prompt failed';
                    return { ok: false, error: msg };
                }
                immediateText = extractTextFromOpencodeParts(normalizeSessionPromptEnvelope(promptRes.data)?.parts);
            } else {
                const msg =
                    asyncRes.error && typeof asyncRes.error === 'object' && 'message' in asyncRes.error
                        ? String((asyncRes.error as { message?: unknown }).message)
                        : 'OpenCode prompt_async failed';
                return { ok: false, error: msg };
            }
        }
    } else {
        // #region agent log
        am4DebugLog('am4OpencodeClient.ts:skip-prompt-async', 'v2 prompt accepted but no text yet; skip prompt_async', {
            runId: 'post-fix',
        }, 'H9');
        // #endregion
    }

    if (immediateText.trim()) {
        return { ok: true, text: immediateText };
    }

    // #region agent log
    am4DebugLog('am4OpencodeClient.ts:before-v1-wait-loop', 'starting v1 messages wait+poll', {
        runId: 'post-fix',
    }, 'poll');
    // #endregion

    const text = await waitForAssistantTextViaV1SessionMessages({
        client,
        sessionID,
    });

    if (text.trim()) {
        return { ok: true, text };
    }

    // #region agent log
    am4DebugLog('am4OpencodeClient.ts:after-v1-wait-failed', 'no text after v1 wait loop', {
        runId: 'post-fix',
    }, 'poll');
    // #endregion

    return {
        ok: false,
        error:
            'OpenCode returned no assistant text. If the hosted UI also shows no execution, configure an LLM provider on the OpenCode server and check reverse-proxy/WebSocket settings. AM4 tried v2 prompt first, then v1 prompt_async when needed.',
    };
}
