import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";
import FormData from 'form-data';
import { Readable } from 'stream';
import { ModelUserApiKey } from "../../../schema/schemaUser/SchemaUserApiKey.schema";
import { getFile, S3Config } from "../../upload/uploadFunc";
import { getApiKeyByObject } from "../../llm/llmCommonFunc";

const fetchAudioUnified = async ({
    audioArrayBuffer,

    llmAuthToken,
    provider,
    userApiKeys,
}: {
    audioArrayBuffer: ArrayBuffer;

    llmAuthToken: string;
    provider: 'groq' | 'localai' | 'runpod' | 'replicate';
    userApiKeys?: any; // Optional for backward compatibility
}): Promise<string> => {
    try {
        if (provider !== 'groq' && provider !== 'localai' && provider !== 'runpod' && provider !== 'replicate') {
            return '';
        }

        // Convert ArrayBuffer to Buffer for FormData
        const audioBuffer = Buffer.from(audioArrayBuffer);

        if (provider === 'groq') {
            let data = new FormData();
            data.append('model', 'whisper-large-v3');
            data.append('file', audioBuffer, 'a.wav');
            data.append('response_format', 'verbose_json');

            const config: AxiosRequestConfig = {
                method: 'post',
                maxBodyLength: Infinity,
                url: 'https://api.groq.com/openai/v1/audio/transcriptions',
                headers: {
                    'Authorization': `Bearer ${llmAuthToken}`,
                    'Content-Type': 'multipart/form-data'
                },
                data: data,
            };

            const response: AxiosResponse = await axios.request(config);
            return response.data.text;
        }

        if (provider === 'localai') {
            // LocalAI uses OpenAI-compatible API
            if (!userApiKeys || !userApiKeys.apiKeyLocalaiEndpoint) {
                return '';
            }

            const form = new FormData();
            form.append('file', audioBuffer, 'a.wav');
            form.append('model', 'whisper-tiny');

            const headers: any = form.getHeaders();

            // Add API key if provided
            if (userApiKeys.apiKeyLocalai && userApiKeys.apiKeyLocalai.trim()) {
                headers['Authorization'] = `Bearer ${userApiKeys.apiKeyLocalai}`;
            }

            const config: AxiosRequestConfig = {
                method: 'post',
                maxBodyLength: Infinity,
                url: `${userApiKeys.apiKeyLocalaiEndpoint}/v1/audio/transcriptions`,
                headers: headers,
                data: form,
            };

            const response: AxiosResponse = await axios.request(config);
            return response.data.text;
        }

        if (provider === 'runpod') {
            // RunPod audio transcription using Whisper model
            const config: AxiosRequestConfig = {
                method: 'post',
                url: 'https://api.runpod.ai/v2/whisper-v3-large/runsync',
                headers: {
                    'Authorization': `Bearer ${llmAuthToken}`,
                    'Content-Type': 'application/json'
                },
                data: {
                    input: {
                        "prompt":"",
                        audio_base64: audioBuffer.toString('base64'),
                    }
                },
            };

            const response: AxiosResponse = await axios.request(config);
            if (response.data && response.data.output && response.data.output.result) {
                return response.data.output.result;
            }
            console.error('RunPod response: ', response);
            return '';
        }

        if (provider === 'replicate') {
            // Replicate Whisper model for audio transcription
            const config: AxiosRequestConfig = {
                method: 'post',
                url: 'https://api.replicate.com/v1/predictions',
                headers: {
                    'Authorization': `Bearer ${llmAuthToken}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'wait'
                },
                data: {
                    version: 'openai/whisper:770db50964b436879e870139c9c1504d6326774d8acc92e6815c19b68367ec51',
                    input: {
                        audio: `data:audio/wav;base64,${audioBuffer.toString('base64')}`,
                        model: 'large',
                        translate: true
                    }
                },
            };

            const response: AxiosResponse = await axios.request(config);
            if (response.data && response.data.output) {
                return response.data.output;
            }
            return '';
        }

        return '';
    } catch (error: any) {
        if (isAxiosError(error)) {
            console.error(error.message);
        }
        console.error(error);
        console.error(error?.response);
        return '';
    }
};

const bufferToArrayBuffer = (buffer: Buffer): ArrayBuffer => {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};

const getTextFromAudioByUrlAndUsername = async ({
    fileUrl,
    username,
}: {
    fileUrl: string;
    username: string;
}): Promise<{
    success: string;
    error: string;
    data: {
        contentAudioToText: string;
    }
}> => {
    try {
        const userApiKey = await ModelUserApiKey.findOne({
            username,
        });

        if (!userApiKey) {
            return {
                success: '',
                error: 'User api key not found',
                data: {
                    contentAudioToText: '',
                },
            };
        }

        // Check if at least one API key is valid for audio transcription
        const hasValidApiKey = userApiKey.apiKeyGroqValid ||
                               userApiKey.apiKeyLocalaiValid ||
                               userApiKey.apiKeyRunpodValid ||
                               userApiKey.apiKeyReplicateValid;

        if (!hasValidApiKey) {
            return {
                success: '',
                error: 'No valid API key found for audio transcription',
                data: {
                    contentAudioToText: '',
                },
            };
        }

        const userApiKeyObj = getApiKeyByObject(userApiKey);

        const s3Config: S3Config = {
            region: userApiKeyObj.apiKeyS3Region,
            endpoint: userApiKeyObj.apiKeyS3Endpoint,
            accessKeyId: userApiKeyObj.apiKeyS3AccessKeyId,
            secretAccessKey: userApiKeyObj.apiKeyS3SecretAccessKey,
            bucketName: userApiKeyObj.apiKeyS3BucketName,
        };

        const resultAudio = await getFile({
            fileName: fileUrl,
            storageType: userApiKey.fileStorageType === 's3' ? 's3' : 'gridfs',
            s3Config: userApiKey.fileStorageType === 's3' ? s3Config : undefined,
        });

        // validate file
        if (!resultAudio.success || !resultAudio.content) {
            return {
                success: '',
                error: 'File not found or not belong to user',
                data: {
                    contentAudioToText: '',
                },
            };
        }

        // get audio buffer
        const buffer = resultAudio.content;
        const audioBufferT = bufferToArrayBuffer(buffer);

        let contentAudioToText = '';
        let provider = '' as 'groq' | 'localai' | 'runpod' | 'replicate';
        let llmAuthToken = '' as string;
        let llmBaseUrl = '' as string;

        if (userApiKeyObj.apiKeyGroqValid === true) {
            provider = 'groq';
            llmAuthToken = userApiKeyObj.apiKeyGroq;
        } else if (userApiKeyObj.apiKeyLocalaiValid === true) {
            provider = 'localai';
            llmBaseUrl = userApiKeyObj.apiKeyLocalaiEndpoint;
            llmAuthToken = userApiKeyObj.apiKeyLocalai || '';
        } else if (userApiKeyObj.apiKeyRunpodValid === true) {
            provider = 'runpod';
            llmAuthToken = userApiKeyObj.apiKeyRunpod;
        } else if (userApiKeyObj.apiKeyReplicateValid === true) {
            provider = 'replicate';
            llmAuthToken = userApiKeyObj.apiKeyReplicate;
        }

        if (provider) {
            console.log(`fetching audio to text from ${provider}`);
            contentAudioToText = await fetchAudioUnified({
                audioArrayBuffer: audioBufferT,

                provider: provider as any,
                llmAuthToken,
                userApiKeys: userApiKeyObj,
            })
        }

        return {
            success: 'Success',
            error: '',
            data: {
                contentAudioToText,
            },
        };
    } catch (error) {
        console.error(error);
        return {
            success: '',
            error: 'Server error',
            data: {
                contentAudioToText: '',
            },
        }
    }
}

// Example usage
// const result = await fetchLlmGroqAudio({
//     audioBase64: "data:audio/webm;base64,..."
// })

export {
    bufferToArrayBuffer,
    getTextFromAudioByUrlAndUsername,
};
export default fetchAudioUnified;