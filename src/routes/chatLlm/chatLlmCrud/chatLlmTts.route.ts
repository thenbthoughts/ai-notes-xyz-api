/**
 * POST /api/chat-llm/tts/speak
 *
 * Converts the given text to speech using the user's configured TTS provider
 * (OpenAI → Groq fallback) and streams the audio binary back to the client.
 *
 * Body: { text: string }
 * Response: audio/mpeg or audio/wav binary content
 */

import { Router, Request, Response } from 'express';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';
import fetchTtsUnified from '../../../utils/llmPendingTask/utils/fetchTtsUnified';

const router = Router();

const MAX_TTS_CHARS = 4096;

router.post(
    '/speak',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const { text, ttsModelProvider, ttsModelName } = req.body as { text?: string; ttsModelProvider?: string; ttsModelName?: string };

            if (!text || typeof text !== 'string' || text.trim().length === 0) {
                return res.status(400).json({ message: 'text is required' });
            }

            const apiKeys = getApiKeyByObject(res.locals.apiKey);

            // Truncate to avoid extremely large TTS requests
            const safeText = text.trim().slice(0, MAX_TTS_CHARS);

            // Provider priority: use thread preference if valid, else OpenAI → Groq → LocalAI
            let provider: 'openai' | 'groq' | 'localai' | null = null;
            let apiKey = '';
            let endpoint = '';
            let model = '';

            if (ttsModelProvider === 'localai' && apiKeys.apiKeyLocalaiValid && apiKeys.apiKeyLocalaiEndpoint) {
                provider = 'localai';
                apiKey = apiKeys.apiKeyLocalai || '';
                endpoint = apiKeys.apiKeyLocalaiEndpoint;
                model = (typeof ttsModelName === 'string' && ttsModelName.trim()) ? ttsModelName.trim() : 'tts';
            } else if (ttsModelProvider === 'openai' && apiKeys.apiKeyOpenaiValid && apiKeys.apiKeyOpenai) {
                provider = 'openai';
                apiKey = apiKeys.apiKeyOpenai;
            } else if (ttsModelProvider === 'groq' && apiKeys.apiKeyGroqValid && apiKeys.apiKeyGroq) {
                provider = 'groq';
                apiKey = apiKeys.apiKeyGroq;
            }

            if (!provider) {
                if (apiKeys.apiKeyOpenaiValid && apiKeys.apiKeyOpenai) {
                    provider = 'openai';
                    apiKey = apiKeys.apiKeyOpenai;
                } else if (apiKeys.apiKeyGroqValid && apiKeys.apiKeyGroq) {
                    provider = 'groq';
                    apiKey = apiKeys.apiKeyGroq;
                } else if (apiKeys.apiKeyLocalaiValid && apiKeys.apiKeyLocalaiEndpoint) {
                    provider = 'localai';
                    apiKey = apiKeys.apiKeyLocalai || '';
                    endpoint = apiKeys.apiKeyLocalaiEndpoint;
                    model = 'tts';
                }
            }

            if (!provider) {
                return res.status(400).json({
                    message: 'No valid TTS API key found. Please add an OpenAI, Groq, or LocalAI API key in your settings.',
                });
            }

            const result = await fetchTtsUnified({
                text: safeText,
                provider,
                apiKey,
                ...(provider === 'localai' ? { endpoint, model } : {}),
            });

            if (!result.success || !result.audioBuffer) {
                console.error('TTS failed:', result.error);
                return res.status(500).json({ message: 'TTS generation failed', error: result.error });
            }

            res.set('Content-Type', result.contentType);
            res.set('Content-Length', result.audioBuffer.length.toString());
            res.set('Cache-Control', 'no-cache');
            return res.send(result.audioBuffer);
        } catch (error) {
            console.error('TTS route error:', error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;
