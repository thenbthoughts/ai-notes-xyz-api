import axios, { AxiosRequestConfig, isAxiosError } from 'axios';

export type TtsProvider = 'openai' | 'groq';

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
    const { text, provider, apiKey, voice, format } = params;

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
            const selectedVoice = voice || 'Fritz-PlayAI';
            const selectedFormat = format || 'wav';

            const config: AxiosRequestConfig = {
                method: 'post',
                url: 'https://api.groq.com/openai/v1/audio/speech',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                data: {
                    model: 'playai-tts',
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
