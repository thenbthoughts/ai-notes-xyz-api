import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUserApiKey } from '../../schema/SchemaUserApiKey.schema';
import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from 'axios';
import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';
import { putFileToS3 } from '../../utils/files/s3PutFile';
import { getFileFromS3R2 } from '../../utils/files/s3R2GetFile';
import openrouterMarketing from '../../config/openrouterMarketing';

// Router
const router = Router();

interface Message {
    role: string;
    content: string;
}

interface RequestData {
    messages: Message[];
    model: string;
    temperature: number;
    max_tokens: number;
    top_p: number;
    stream: boolean;
    stop: null | string;
}

const fetchLlm = async ({
    apiKey,

    argMessages,
    modelName,
    provider,
}: {
    apiKey: string;

    argMessages: Message[];
    modelName: string,
    provider: 'groq' | 'openrouter';
}): Promise<boolean> => {
    try {
        let apiEndpoint = '';
        if (provider === 'openrouter') {
            apiEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
        } else if (provider === 'groq') {
            apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
        }

        if (apiKey === '') {
            return false;
        }

        const data: RequestData = {
            messages: argMessages,
            model: modelName,
            temperature: 1,
            max_tokens: 100,
            top_p: 1,
            stream: false,
            stop: null
        };

        const config: AxiosRequestConfig = {
            method: 'post',
            url: apiEndpoint,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                ...openrouterMarketing,
            },
            data: JSON.stringify(data)
        };

        const response: AxiosResponse = await axios.request(config);
        const resultText = response.data.choices[0].message.content;
        console.log(resultText);

        if (resultText.length >= 1) {
            return true;
        }

        return false;
    } catch (error) {
        if (isAxiosError(error)) {
            console.error(error.message);
        }
        console.log(error);
        return false;
    }
};

// Update User API Groq
router.post(
    '/updateUserApiGroq',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { apiKeyGroq } = req.body;

            let apiKeyGroqValid = false;
            apiKeyGroqValid = await fetchLlm({
                apiKey: apiKeyGroq,
                argMessages: [
                    {
                        role: "user",
                        content: 'About artificial intelligence.'
                    }
                ],
                modelName: 'meta-llama/llama-4-scout-17b-16e-instruct',
                provider: 'groq',
            });

            if (!apiKeyGroqValid) {
                return res.status(400).json({ message: 'Invalid API Key' });
            }

            const updatedUser = await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    apiKeyGroq: apiKeyGroq,
                    apiKeyGroqValid: apiKeyGroqValid,
                },
                {
                    new: true
                }
            );
            if (!updatedUser) {
                return res.status(404).json({ message: 'User not found' });
            }
            return res.json({
                success: 'Updated',
                error: '',
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Update User API Openrouter
router.post(
    '/updateUserApiOpenrouter',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { apiKeyOpenrouter } = req.body;

            let apiKeyOpenrouterValid = false;
            apiKeyOpenrouterValid = await fetchLlm({
                apiKey: apiKeyOpenrouter,
                argMessages: [
                    {
                        role: "user",
                        content: 'About artificial intelligence.'
                    }
                ],
                modelName: 'meta-llama/llama-3.2-11b-vision-instruct',
                provider: 'openrouter',
            });

            if (!apiKeyOpenrouterValid) {
                return res.status(400).json({ message: 'Invalid API Key' });
            }

            const updatedUser = await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    apiKeyOpenrouter: apiKeyOpenrouter,
                    apiKeyOpenrouterValid: apiKeyOpenrouterValid,
                },
                {
                    new: true
                }
            );
            if (!updatedUser) {
                return res.status(404).json({ message: 'User not found' });
            }
            return res.json({
                success: 'Updated',
                error: '',
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Update User API S3
router.post(
    '/updateUserApiS3',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const apiKeys = getApiKeyByObject(req.body);

            const randomNum = Math.floor(
                Math.random() * 1_000_000,
            );
            const curDateTime = new Date().valueOf();
            const fileContent = `file-upload-test-${res.locals.auth_username}-${curDateTime}-${randomNum}`;
            const fileName = `file-upload-test-${res.locals.auth_username}.txt`;

            console.log(fileName, fileContent);

            const resultPut = await putFileToS3({
                fileName: fileName,
                fileContent: fileContent,
                userApiKey: apiKeys,
            })
            if (resultPut.uploadStatus === false) {
                return res.status(400).json({
                    success: '',
                    error: `Error uploading file to S3. ${resultPut.error}`,
                });
            }

            const resultGet = await getFileFromS3R2({
                fileName: fileName,
                userApiKey: apiKeys,
            });

            const resultGetContent = await resultGet?.Body?.transformToByteArray();
            const resultGetString = resultGetContent ? Buffer.from(resultGetContent).toString('utf-8') : '';

            if (`${resultGetString}` === fileContent) {
                console.log('The content matches the uploaded file content.');
            } else {
                console.log('The content does not match the uploaded file content.');
                return res.status(500).json({
                    success: '',
                    error: 'Error: Unexpected error occured. Please try again.',
                });
            }

            await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    apiKeyS3Valid: true,
                    apiKeyS3AccessKeyId: apiKeys.apiKeyS3AccessKeyId,
                    apiKeyS3BucketName: apiKeys.apiKeyS3BucketName,
                    apiKeyS3Endpoint: apiKeys.apiKeyS3Endpoint,
                    apiKeyS3Region: apiKeys.apiKeyS3Region,
                    apiKeyS3SecretAccessKey: apiKeys.apiKeyS3SecretAccessKey,
                },
                {
                    new: true
                }
            );

            return res.json({
                success: 'Updated',
                error: '',
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;