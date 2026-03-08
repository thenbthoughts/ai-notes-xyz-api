import { Router, Request, Response } from 'express';

import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import { fetchLlmUnified, Message } from '../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../chatLlmCrud/answerMachineV2/helperFunction/answerMachineGetLlmConfig';

const router = Router();

/** Parse JSON from LLM response and return decision payload { shouldSend, increaseTimer } or null. */
function getJsonFromResponse({
    content,
}: {
    content: string | undefined;
}): { shouldSend: boolean; increaseTimer: number } | null {
    let returnObj = {
        shouldSend: true,
        increaseTimer: 0,
    }

    const raw = content?.trim() ?? '';
    if (!raw) return returnObj;
    let jsonPayload: unknown;
    try {
        jsonPayload = JSON.parse(raw);
    } catch {
        const firstBrace = raw.indexOf('{');
        const lastBrace = raw.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
                jsonPayload = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
            } catch (error) {
                console.error('Failed to parse JSON from response', error);
            }
        } else {
            console.error('Failed to parse JSON from response', raw);
        }
    }

    if (!jsonPayload || typeof jsonPayload !== 'object') {
        console.error('Failed to parse JSON from response: Invalid JSON format', raw);
        return returnObj;
    }

    const incoming = jsonPayload as Record<string, unknown>;
    const parsedShouldSend = incoming?.shouldSend;
    const parsedIncreaseTimer = incoming?.increaseTimer;
    
    // should send
    if (typeof parsedShouldSend === 'boolean') {
        returnObj.shouldSend = parsedShouldSend;
    }

    // increase timer: 0–60 when shouldSend is false; must be 0 when shouldSend is true
    const increaseTimerNum = typeof parsedIncreaseTimer === 'number' ? Math.floor(parsedIncreaseTimer) : 0;
    const safeSeconds = Number.isFinite(increaseTimerNum) ? increaseTimerNum : 0;
    returnObj.increaseTimer = returnObj.shouldSend ? 0 : Math.max(0, Math.min(60, safeSeconds));

    return returnObj;
}

const DECISION_SYSTEM_PROMPT = `
You are a classification service for a voice-call assistant.
Return a strict JSON object with two fields:
- shouldSend: boolean (true when assistant should generate a response now)
- increaseTimer: number (seconds to extend waiting before next auto-send, 0 means no extension)

Rules:
- Set shouldSend true if the transcript is a clear user request/question or complete statement that should be answered now.
- Set shouldSend false for short pauses, stutters, filler words, unclear fragments, or content that looks incomplete.
- If the user says they want to wait at the end of the transcript (e.g. "wait", "hold on", "give me a moment", "one sec", "wait a second", "hold on a sec"), set shouldSend false and set increaseTimer to a positive number of seconds (e.g. 10–15) so the assistant waits longer before auto-sending.
- increaseTimer should be an integer number of seconds (0–60). When shouldSend is true, use increaseTimer 0.
`.trim();

router.post(
    '/decide-send',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;

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

            const llmConfig = await getLlmConfig({ threadId: thread._id });
            if (!llmConfig) {
                return res.status(400).json({ message: 'No valid LLM credentials found for decision endpoint' });
            }

            const llmResult = await fetchLlmUnified({
                provider: llmConfig.provider,
                apiKey: llmConfig.apiKey,
                apiEndpoint: llmConfig.apiEndpoint,
                model: llmConfig.model,
                temperature: 0.1,
                maxTokens: 120,
                messages: [
                    { role: 'system', content: DECISION_SYSTEM_PROMPT } as Message,
                    { role: 'user', content: `Transcript: """${transcript}"""` } as Message,
                ],
                headersExtra: llmConfig.customHeaders,
            });

            if (llmResult.success === false) {
                return res.status(500).json({ message: 'LLM decision request failed', error: llmResult.error });
            }

            const payload = getJsonFromResponse({
                content: llmResult.content,
            });
            if (!payload) {
                return res.status(500).json({
                    message: 'Failed to parse decision payload',
                    raw: llmResult.content,
                });
            }
            return res.json(payload);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;
