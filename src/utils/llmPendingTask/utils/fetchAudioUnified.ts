import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";
import FormData from 'form-data';
import { GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { ModelUserApiKey } from "../../../schema/SchemaUserApiKey.schema";
import { getFileFromS3R2 } from "../../files/s3R2GetFile";
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

const getCustomArrayBuffer = async (response: GetObjectCommandOutput): Promise<ArrayBuffer | null> => {
    // Step 2: Convert the stream (response.Body) to an ArrayBuffer
    const stream = response.Body as Readable;

    // Create an empty array to hold the chunks
    const chunks: Buffer[] = [];

    // Use the 'data' event to collect chunks from the stream
    stream.on('data', (chunk) => {
        chunks.push(chunk); // Push each chunk to the array
    });

    // When the stream ends, concatenate the chunks and convert to ArrayBuffer
    return new Promise((resolve, reject) => {
        stream.on('end', () => {
            // Concatenate all chunks into a single Buffer
            const buffer = Buffer.concat(chunks);
            // Convert the Buffer to ArrayBuffer
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            resolve(arrayBuffer);
        });

        stream.on('error', (err) => {
            reject(null);
        });
    });
}

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

        const resultAudio = await getFileFromS3R2({
            fileName: fileUrl,
            userApiKey: userApiKeyObj,
        });

        // validdate file
        if (resultAudio) {
            // valid
        } else {
            return {
                success: '',
                error: 'File not found or not belong to user',
                data: {
                    contentAudioToText: '',
                },
            };
        }

        // get audio buffer
        const audioBufferT = await getCustomArrayBuffer(resultAudio);
        if (audioBufferT) {
            const buffer = Buffer.from(audioBufferT);

            let contentAudioToText = '';
            if (userApiKeyObj.apiKeyGroqValid === true) {
                contentAudioToText = await fetchLlmGroqAudio({
                    audioArrayBuffer: buffer,

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
        }

        return {
            success: '',
            error: 'File not found',
            data: {
                contentAudioToText: '',
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
    getCustomArrayBuffer,
    getTextFromAudioByUrlAndUsername,
};
export default fetchLlmGroqAudio;