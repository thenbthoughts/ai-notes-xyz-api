import { Router, Request, Response } from 'express';
import { Ollama } from 'ollama';
import { QdrantClient } from '@qdrant/js-client-rest';
import nodemailer from 'nodemailer';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from 'axios';
import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';
import { putFile, getFile, S3Config } from '../../utils/upload/uploadFunc';
import openrouterMarketing from '../../config/openrouterMarketing';
import { ModelUser } from '../../schema/schemaUser/SchemaUser.schema';
import { funcSendMail } from '../../utils/files/funcSendMail';

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
                modelName: 'openai/gpt-oss-20b',
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
                modelName: 'openai/gpt-oss-20b',
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

// Update User File Storage Type
router.post(
    '/updateUserApiFileStorageType',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { fileStorageType } = req.body;

            if (typeof fileStorageType !== 'string') {
                return res.status(400).json({ message: 'Invalid file storage type' });
            }

            if (fileStorageType !== 'gridfs' && fileStorageType !== 's3') {
                return res.status(400).json({ message: 'Invalid file storage type' });
            }

            await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    fileStorageType: fileStorageType,
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

            const s3Config: S3Config = {
                region: apiKeys.apiKeyS3Region,
                endpoint: apiKeys.apiKeyS3Endpoint,
                accessKeyId: apiKeys.apiKeyS3AccessKeyId,
                secretAccessKey: apiKeys.apiKeyS3SecretAccessKey,
                bucketName: apiKeys.apiKeyS3BucketName,
            };

            const resultPut = await putFile({
                fileName: fileName,
                fileContent: fileContent,
                storageType: 's3',
                s3Config: s3Config,
            });

            if (!resultPut.success) {
                return res.status(400).json({
                    success: '',
                    error: `Error uploading file to S3. ${resultPut.error}`,
                });
            }

            const resultGet = await getFile({
                fileName: fileName,
                storageType: 's3',
                s3Config: s3Config,
            });

            if (!resultGet.success || !resultGet.content) {
                return res.status(500).json({
                    success: '',
                    error: 'Error: Failed to retrieve uploaded file.',
                });
            }

            const resultGetString = resultGet.content.toString('utf-8');

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

// Update User API Ollama
router.post(
    '/updateUserApiOllama',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { apiKeyOllamaEndpoint } = req.body;

            let apiKeyOllamaValid = false;

            const ollamaClient = new Ollama({
                host: apiKeyOllamaEndpoint,
            });

            const resultOllama = await ollamaClient.list();
            console.log(resultOllama);

            if (resultOllama.models.length >= 1) {
                apiKeyOllamaValid = true;
            }

            if (!apiKeyOllamaValid) {
                return res.status(400).json({ message: 'Invalid API Key' });
            }

            await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    apiKeyOllamaValid: apiKeyOllamaValid,
                    apiKeyOllamaEndpoint: apiKeyOllamaEndpoint,
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

// Update User API Qdrant
router.post(
    '/updateUserApiQdrant',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        let resWhatIsWorking = '';

        try {
            const { apiKeyQdrantEndpoint, apiKeyQdrantPassword } = req.body;

            let apiKeyQdrantValid = false;

            const qdrantUrl = new URL(apiKeyQdrantEndpoint);
            const config = {
                qdrant: {
                    url: apiKeyQdrantEndpoint,
                    port: parseInt(qdrantUrl.port || (qdrantUrl.protocol === 'https:' ? '443' : '80')),
                    apiKey: apiKeyQdrantPassword,
                }
            };

            const qdrantClient = new QdrantClient({
                url: config.qdrant.url,
                port: config.qdrant.port,
                apiKey: config.qdrant.apiKey,
            });

            try {
                const resultQdrant = await qdrantClient.versionInfo();
                console.log('resultQdrant: ', resultQdrant);
            } catch (error) {
                console.error('Qdrant connection failed:', error);
                resWhatIsWorking += 'Failed to connect to Qdrant. ';

                return res.status(400).json({
                    success: '',
                    error: `Invalid API Key. Error: ${resWhatIsWorking}`
                });
            }

            // Test creating a collection to verify write permissions
            try {
                const testCollectionName = `test_collection_${new Date().valueOf()}`;
                await qdrantClient.createCollection(testCollectionName, {
                    vectors: {
                        size: 128,
                        distance: 'Cosine'
                    }
                });

                // Insert a test record
                await qdrantClient.upsert(testCollectionName, {
                    points: [{
                        id: 1,
                        vector: Array(128).fill(0.1),
                        payload: { test: true }
                    }]
                });

                // Clean up test collection
                await qdrantClient.deleteCollection(testCollectionName);

                apiKeyQdrantValid = true;
                resWhatIsWorking += 'Successfully inserted test record. ';
            } catch (testError) {
                console.error('Qdrant test record insertion failed:', testError);
                resWhatIsWorking += 'Failed to insert test record. ';

                return res.status(400).json({
                    success: '',
                    error: `Invalid API Key. Error: ${resWhatIsWorking}`
                });
            }

            if (!apiKeyQdrantValid) {
                return res.status(400).json({
                    success: '',
                    error: `Invalid API Key. Error: ${resWhatIsWorking}`
                });
            }

            await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    apiKeyQdrantValid: apiKeyQdrantValid,
                    apiKeyQdrantEndpoint: apiKeyQdrantEndpoint,
                    apiKeyQdrantPassword: apiKeyQdrantPassword,
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

// Update User API SMTP
router.post(
    '/updateUserApiSmtp',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const {
                // required - api key
                smtpHost,
                smtpPort,
                smtpUser,
                smtpPassword,

                // fields send from email
                smtpFrom,

                // fields send to email
                smtpTo,
            } = req.body;

            let smtpValid = false;

            const transporter = nodemailer.createTransport({
                host: smtpHost,
                port: smtpPort,
                auth: {
                    user: smtpUser,
                    pass: smtpPassword,
                },
            });

            const info = await transporter.sendMail({
                from: smtpFrom,
                to: smtpTo,
                subject: 'Test Email',
                text: 'This is a test email send from ai-notes.xyz',
            });

            console.log('info: ', info);

            if (info.accepted.length > 0) {
                smtpValid = true;
            } else {
                smtpValid = false;
            }

            await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    // api key
                    smtpValid: smtpValid,
                    smtpHost: smtpHost,
                    smtpPort: smtpPort,
                    smtpUser: smtpUser,
                    smtpPassword: smtpPassword,

                    // fields send from email
                    smtpFrom: smtpFrom,
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
            return res.status(500).json({
                message: 'Server error',
            });
        }
    }
);

// User Email Verify Send OTP
router.post(
    '/userEmailVerifySendOtp',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { email } = req.body;

            const otp = Math.floor(100000 + Math.random() * 900000);

            await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    userEmailVerifyOtp: otp,
                    userEmailVerifyEmail: email,
                },
                {
                    new: true
                }
            );

            const sendStatus = await funcSendMail({
                username: res.locals.auth_username,
                smtpTo: email,
                subject: 'AI Notes XYZ - Email Verification',
                text: `Hello from AI Notes XYZ. Your verification code is: ${otp}. Please do not share this code with anyone.`,
            });

            if (!sendStatus) {
                return res.status(400).json({
                    success: '',
                    error: 'Failed to send email',
                });
            }

            return res.json({
                success: 'Updated',
                error: '',
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                message: 'Server error',
            });
        }
    }
);

// User Email Verify Verify OTP
router.post(
    '/userEmailVerifyVerifyOtp',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { otp } = req.body;

            console.log('otp: ', otp, typeof otp);

            if (typeof otp !== 'number') {
                return res.status(400).json({
                    success: '',
                    error: 'Invalid OTP',
                });
            }

            const user = await ModelUserApiKey.findOne({
                username: res.locals.auth_username
            });

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            if (user.userEmailVerifyOtp !== otp) {
                return res.status(400).json({
                    success: '',
                    error: 'Invalid OTP',
                });
            }

            await ModelUser.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    emailVerified: true,
                    email: user.userEmailVerifyEmail,
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
            return res.status(500).json({
                message: 'Server error',
            });
        }
    }
);

// User Email Verify Clear
router.post(
    '/userEmailVerifyClear',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    // api key
                    userEmailVerifyOtp: 0,
                    userEmailVerifyEmail: '',
                },
                {
                    new: true
                }
            );

            await ModelUser.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    email: '',
                    emailVerified: false,
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
            return res.status(500).json({
                message: 'Server error',
            });
        }
    }
);

// Update User Client Frontend URL
router.post(
    '/updateUserApiClientFrontendUrl',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { clientFrontendUrl } = req.body;

            if (typeof clientFrontendUrl !== 'string') {
                return res.status(400).json({
                    success: '',
                    error: 'Invalid client frontend url',
                });
            }

            await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    clientFrontendUrl: clientFrontendUrl,
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
            return res.status(500).json({
                message: 'Server error',
            });
        }
    }
);

export default router;