import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";
import FormData from 'form-data';
import { Readable } from 'stream';
import { ModelUserApiKey } from "../../../schema/schemaUser/SchemaUserApiKey.schema";
import { getFile, S3Config } from "../../upload/uploadFunc";
import { getApiKeyByObject } from "../../llm/llmCommonFunc";

const fetchLlmGroqAudio = async ({
    audioArrayBuffer,

    llmAuthToken,
    provider,
}: {
    audioArrayBuffer: ArrayBuffer;

    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}): Promise<string> => {
    try {
        if (provider !== 'groq') {
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
            data: data,
        };

        const response: AxiosResponse = await axios.request(config);
        return response.data.text;
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

        if (userApiKey.apiKeyGroqValid === false) {
            return {
                success: '',
                error: 'User api key is not valid',
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
        if (userApiKeyObj.apiKeyGroqValid === true) {
            contentAudioToText = await fetchLlmGroqAudio({
                audioArrayBuffer: audioBufferT,

                provider: 'groq',
                llmAuthToken: userApiKeyObj.apiKeyGroq,
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
export default fetchLlmGroqAudio;