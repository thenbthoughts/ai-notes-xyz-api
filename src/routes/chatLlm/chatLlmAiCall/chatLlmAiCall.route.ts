import { Router, Request, Response } from 'express';

import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelOpenaiCompatibleModel } from '../../../schema/schemaUser/SchemaOpenaiCompatibleModel.schema';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import { fetchLlmUnified, Message } from '../../../utils/llmPendingTask/utils/fetchLlmUnified';

const router = Router();

type DecisionTextModelProvider = 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';

const parseDecisionPayload = (value: unknown): {
    shouldSend: boolean;
    increaseTimer: number;
} | null => {
    if (!value || typeof value !== 'object') return null;

    const incoming = value as Record<string, unknown>;
    const parsedShouldSend = incoming?.shouldSend;
    const parsedIncreaseTimer = incoming?.increaseTimer;

    if (typeof parsedShouldSend !== 'boolean') return null;

    const increaseTimerNum = typeof parsedIncreaseTimer === 'number'
        ? Math.max(0, Math.floor(parsedIncreaseTimer))
        : 0;

    return {
        shouldSend: parsedShouldSend,
        increaseTimer: increaseTimerNum,
    };
};

const parseJsonFromText = (raw: string): unknown | null => {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();

    try {
        return JSON.parse(trimmed);
    } catch {
        const firstBrace = trimmed.indexOf('{');
        const lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
                return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
};

const normalizeDecisionTimerMs = (seconds: number, fallbackMs = 2000): number => {
    const safeSeconds = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
    if (!safeSeconds || safeSeconds <= 0) {
        return fallbackMs;
    }

    return Math.max(1_000, safeSeconds * 1000);
};

// Analyze transcript and decide whether to send now.
router.post(
    '/decide-send',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;
            const apiKeys = getApiKeyByObject(res.locals.apiKey);

            const transcript = typeof req.body?.transcript === 'string' ? req.body.transcript.trim() : '';
            if (!transcript) {
                return res.status(400).json({ message: 'Transcript is required' });
            }

            const threadId = getMongodbObjectOrNull(req.body?.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            const thread = await ModelChatLlmThread.findOne({
                _id: threadId,
                username: auth_username,
            });
            if (!thread) {
                return res.status(400).json({ message: 'Thread not found' });
            }

            let provider: DecisionTextModelProvider = 'openrouter';
            let modelName = thread.aiModelName || 'openai/gpt-oss-20b';
            let apiEndpoint = '';
            let apiKey = '';
            let headersExtra: Record<string, string> | undefined;

            const threadProvider = thread.aiModelProvider as DecisionTextModelProvider | '';
            if (threadProvider === 'openrouter' && apiKeys.apiKeyOpenrouterValid) {
                provider = 'openrouter';
                apiKey = apiKeys.apiKeyOpenrouter;
            } else if (threadProvider === 'groq' && apiKeys.apiKeyGroqValid) {
                provider = 'groq';
                apiKey = apiKeys.apiKeyGroq;
            } else if (threadProvider === 'ollama' && apiKeys.apiKeyOllamaValid) {
                provider = 'ollama';
                apiEndpoint = apiKeys.apiKeyOllamaEndpoint;
            } else if (threadProvider === 'openai-compatible' && thread.aiModelOpenAiCompatibleConfigId) {
                provider = 'openai-compatible';
                const compatModel = await ModelOpenaiCompatibleModel.findOne({
                    _id: thread.aiModelOpenAiCompatibleConfigId,
                    username: auth_username,
                });
                if (!compatModel) {
                    return res.status(400).json({ message: 'OpenAI compatible model config not found' });
                }
                apiKey = compatModel.apiKey;
                modelName = compatModel.modelName || modelName;
                apiEndpoint = compatModel.baseUrl || '';
                if (compatModel.customHeaders?.trim()) {
                    try {
                        const parsedHeaders = JSON.parse(compatModel.customHeaders);
                        if (typeof parsedHeaders === 'object' && parsedHeaders !== null) {
                            headersExtra = parsedHeaders as Record<string, string>;
                        }
                    } catch (error) {
                        console.error('Failed to parse customHeaders for openai-compatible model:', error);
                    }
                }
            } else if (apiKeys.apiKeyOpenrouterValid) {
                provider = 'openrouter';
                apiKey = apiKeys.apiKeyOpenrouter;
            } else if (apiKeys.apiKeyGroqValid) {
                provider = 'groq';
                apiKey = apiKeys.apiKeyGroq;
            } else if (apiKeys.apiKeyOllamaValid) {
                provider = 'ollama';
                apiEndpoint = apiKeys.apiKeyOllamaEndpoint;
            }

            if (provider !== 'ollama' && !apiKey) {
                return res.status(400).json({ message: 'No valid LLM credentials found for decision endpoint' });
            }
            if (provider === 'ollama' && !apiEndpoint) {
                return res.status(400).json({ message: 'No valid Ollama endpoint found for decision endpoint' });
            }
            if (provider === 'openai-compatible' && !apiKey) {
                return res.status(400).json({ message: 'OpenAI compatible API key missing' });
            }

            const openAiCompatibleEndpoint = apiEndpoint
                ? apiEndpoint.replace(/\/$/, '') + '/chat/completions'
                : '';

            const decisionSystemPrompt = `
You are a classification service for a voice-call assistant.
Return a strict JSON object with two fields:
- shouldSend: boolean (true when assistant should generate a response now)
- increaseTimer: number (seconds to extend waiting before next auto-send, 0 means no extension)

Rules:
- Set shouldSend true if the transcript is a clear user request/question or complete statement that should be answered now.
- Set shouldSend false for short pauses, stutters, filler words, unclear fragments, or content that looks incomplete.
- increaseTimer should be an integer number of seconds.
            `.trim();

            const llmResult = await fetchLlmUnified({
                provider,
                apiKey,
                apiEndpoint: provider === 'openai-compatible' ? openAiCompatibleEndpoint : '',
                model: modelName,
                temperature: 0.1,
                maxTokens: 120,
                messages: [
                    { role: 'system', content: decisionSystemPrompt } as Message,
                    { role: 'user', content: `Transcript: """${transcript}"""` } as Message,
                ],
                headersExtra,
            });

            if (llmResult.success === false) {
                return res.status(500).json({ message: 'LLM decision request failed', error: llmResult.error });
            }

            const jsonPayload = parseJsonFromText(llmResult.content);
            const parsed = parseDecisionPayload(jsonPayload);

            if (!parsed) {
                return res.status(500).json({
                    message: 'Failed to parse decision payload',
                    raw: llmResult.content,
                });
            }

            return res.json({
                shouldSend: parsed.shouldSend,
                increaseTimer: normalizeDecisionTimerMs(parsed.increaseTimer, 2000) / 1000,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;
