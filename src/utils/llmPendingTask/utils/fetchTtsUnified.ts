import axios, { AxiosRequestConfig, isAxiosError } from 'axios';

export type TtsProvider = 'openai' | 'groq' | 'localai';

export interface FetchTtsParams {
    text: string;
    provider: TtsProvider;
    apiKey: string;
    /**
     * Voice name. OpenAI supports: alloy, echo, fable, onyx, nova, shimmer
     * Groq supports: Fritz-PlayAI, Aaliyah-PlayAI, etc.
     */
    voice?: string;
    /**
     * Audio format to return. OpenAI supports: mp3, opus, aac, flac, wav, pcm
     * Groq supports: mp3, wav
     */
    format?: string;
    /**
     * For LocalAI: endpoint URL (e.g. http://localhost:8080)
     */
    endpoint?: string;
    /**
     * For LocalAI: model name (e.g. tts, vibevoice, pocket-tts)
     */
    model?: string;
}

export interface FetchTtsResult {
    success: boolean;
    audioBuffer: Buffer | null;
    contentType: string;
    error: string;
}

/**
 * Unified Text-to-Speech utility.
 * Supports OpenAI TTS and Groq TTS (PlayAI) providers.
 * Returns a raw audio Buffer + content-type string ready to stream to clients.
 */
const fetchTtsUnified = async (params: FetchTtsParams): Promise<FetchTtsResult> => {
    const { text, provider, apiKey, voice, format, endpoint, model } = params;

    try {
        if (provider === 'openai') {
            const selectedVoice = voice || 'alloy';
            const selectedFormat = format || 'mp3';

            const config: AxiosRequestConfig = {
                method: 'post',
                url: 'https://api.openai.com/v1/audio/speech',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                data: {
                    model: 'tts-1',
                    input: text,
                    voice: selectedVoice,
                    response_format: selectedFormat,
                },
                responseType: 'arraybuffer',
            };

            const response = await axios.request(config);
            const audioBuffer = Buffer.from(response.data);

            const contentTypeMap: Record<string, string> = {
                mp3: 'audio/mpeg',
                opus: 'audio/ogg',
                aac: 'audio/aac',
                flac: 'audio/flac',
                wav: 'audio/wav',
                pcm: 'audio/pcm',
            };

            return {
                success: true,
                audioBuffer,
                contentType: contentTypeMap[selectedFormat] || 'audio/mpeg',
                error: '',
            };
        }

        if (provider === 'groq') {
            // autumn diana hannah austin daniel troy
            const selectedVoice = voice || 'diana';
            const selectedFormat = format || 'wav';

            const config: AxiosRequestConfig = {
                method: 'post',
                url: 'https://api.groq.com/openai/v1/audio/speech',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                data: {
                    model: 'canopylabs/orpheus-v1-english',
                    input: text,
                    voice: selectedVoice,
                    response_format: selectedFormat,
                },
                responseType: 'arraybuffer',
            };

            const response = await axios.request(config);
            const audioBuffer = Buffer.from(response.data);

            return {
                success: true,
                audioBuffer,
                contentType: selectedFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav',
                error: '',
            };
        }

        if (provider === 'localai') {
            if (!endpoint || !endpoint.trim()) {
                return {
                    success: false,
                    audioBuffer: null,
                    contentType: '',
                    error: 'LocalAI endpoint is required',
                };
            }

            const baseUrl = endpoint.replace(/\/$/, '');
            const selectedModel = model || 'tts';
            const selectedFormat = format || 'wav';

            const config: AxiosRequestConfig = {
                method: 'post',
                url: `${baseUrl}/v1/audio/speech`,
                headers: {
                    'Content-Type': 'application/json',
                    ...(apiKey && apiKey.trim() ? { 'Authorization': `Bearer ${apiKey}` } : {}),
                },
                data: {
                    model: selectedModel,
                    input: text,
                    voice: voice !== '' ? voice : undefined,
                    response_format: selectedFormat,
                },
                responseType: 'arraybuffer',
            };

            const response = await axios.request(config);
            const audioBuffer = Buffer.from(response.data);

            const contentTypeMap: Record<string, string> = {
                mp3: 'audio/mpeg',
                opus: 'audio/ogg',
                aac: 'audio/aac',
                flac: 'audio/flac',
                wav: 'audio/wav',
                pcm: 'audio/pcm',
            };

            return {
                success: true,
                audioBuffer,
                contentType: contentTypeMap[selectedFormat] || 'audio/wav',
                error: '',
            };
        }

        return {
            success: false,
            audioBuffer: null,
            contentType: '',
            error: `Unsupported TTS provider: ${provider}`,
        };
    } catch (error: any) {
        if (isAxiosError(error)) {
            const errMsg = error.response?.data
                ? Buffer.isBuffer(error.response.data)
                    ? error.response.data.toString('utf-8')
                    : JSON.stringify(error.response.data)
                : error.message;
            console.error('TTS error:', errMsg);
            return {
                success: false,
                audioBuffer: null,
                contentType: '',
                error: errMsg,
            };
        }
        console.error('TTS error:', error);
        return {
            success: false,
            audioBuffer: null,
            contentType: '',
            error: (error as Error)?.message || 'Unknown TTS error',
        };
    }
};

export default fetchTtsUnified;
