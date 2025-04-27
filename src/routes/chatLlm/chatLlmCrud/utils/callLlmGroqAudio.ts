import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";
import FormData from 'form-data';

const fetchLlmGroqAudio = async ({
    audioArrayBuffer,

    llmAuthToken,
    provider,
}: {
    audioArrayBuffer: ArrayBuffer;

    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}) : Promise<string> => {
    try {
        if(provider !== 'groq') {
            return '';
        }

        let data = new FormData();
        data.append('model', 'whisper-large-v3');
        data.append('file', audioArrayBuffer, 'a.wav');
        data.append('response_format', 'verbose_json');

        const config: AxiosRequestConfig = {
            method: 'post',
            maxBodyLength: Infinity,
            url: 'https://api.groq.com/openai/v1/audio/transcriptions',
            headers: {
                'Authorization': `Bearer ${llmAuthToken}`, 
                'Content-Type': 'multipart/form-data'
            },
            data : data,
        };

        const response: AxiosResponse = await axios.request(config);
        return response.data.text;
    } catch (error: any) {
        if(isAxiosError(error)) {
            console.error(error.message);
        }
        console.error(error);
        console.error(error?.response);
        return '';
    }
};

// Example usage
// const result = await fetchLlmGroqAudio({
//     audioBase64: "data:audio/webm;base64,..."
// })

export default fetchLlmGroqAudio;