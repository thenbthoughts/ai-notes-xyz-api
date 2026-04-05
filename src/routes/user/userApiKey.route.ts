import { Router, Request, Response } from 'express';
import { Ollama } from 'ollama';
import { QdrantClient } from '@qdrant/js-client-rest';
import nodemailer from 'nodemailer';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserTelegramConversationCache } from '../../schema/schemaUser/SchemaUserTelegramConversationCache';
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
        const resultTextReasoning = response.data?.choices?.[0]?.message?.reasoning;
        const resultText = response.data?.choices?.[0]?.message?.content;

        if (resultTextReasoning?.length >= 1 || resultText?.length >= 1) {
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
                        role: "system",
                        content: "You are a helpful assistant. Write a short answer to the user's question."
                    },
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
                        role: "system",
                        content: "You are a helpful assistant. Write a short answer to the user's question."
                    },
                    {
                        role: "user",
                        content: 'About artificial intelligence.'
                    }
                ],
                modelName: 'openai/gpt-oss-20b',
                provider: 'openrouter',
            });

            console.log(apiKeyOpenrouterValid);

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

// Update User API Replicate
router.post(
    '/updateUserApiReplicate',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { apiKeyReplicate } = req.body;

            let apiKeyReplicateValid = false;

            // Validate Replicate API key
            if (apiKeyReplicate !== '') {
                try {
                    const config: AxiosRequestConfig = {
                        method: 'get',
                        url: 'https://api.replicate.com/v1/account',
                        headers: {
                            'Authorization': `Bearer ${apiKeyReplicate}`,
                        }
                    };

                    const response: AxiosResponse = await axios.request(config);
                    if (response.status === 200) {
                        apiKeyReplicateValid = true;
                    }
                } catch (error) {
                    console.error('Replicate API key validation failed:', error);
                    apiKeyReplicateValid = false;
                }
            }

            if (!apiKeyReplicateValid) {
                return res.status(400).json({ message: 'Invalid API Key' });
            }

            const updatedUser = await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    apiKeyReplicate: apiKeyReplicate,
                    apiKeyReplicateValid: apiKeyReplicateValid,
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

// Update User API RunPod
router.post(
    '/updateUserApiRunpod',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { apiKeyRunpod } = req.body;

            let apiKeyRunpodValid = false;

            // Validate RunPod API key
            if (apiKeyRunpod !== '') {
                try {
                    const config: AxiosRequestConfig = {
                        method: 'post',
                        url: 'https://api.runpod.ai/v2/granite-4-0-h-small/runsync',
                        headers: {
                            'Authorization': `Bearer ${apiKeyRunpod}`,
                            'Content-Type': 'application/json',
                        },
                        data: {
                            input: {
                                messages: [
                                    {
                                        role: 'system',
                                        content: 'You are a helpful assistant. Please ensure responses are professional, accurate, and safe.'
                                    },
                                    {
                                        role: 'user',
                                        content: 'Generate a random token'
                                    }
                                ],
                                sampling_params: {
                                    max_tokens: 10,
                                    temperature: 0.7,
                                    seed: -1,
                                    top_k: -1,
                                    top_p: 1
                                }
                            }
                        },
                        timeout: 15000, // 15 second timeout for model inference
                    };

                    const response: AxiosResponse = await axios.request(config);
                    if (response.status === 200 && response.data && response.data.output) {
                        apiKeyRunpodValid = true;
                    }
                } catch (error) {
                    console.error('RunPod API key validation failed:', error);
                    apiKeyRunpodValid = false;
                }
            }

            if (!apiKeyRunpodValid) {
                return res.status(400).json({ message: 'Invalid API Key' });
            }

            const updatedUser = await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    apiKeyRunpod: apiKeyRunpod,
                    apiKeyRunpodValid: apiKeyRunpodValid,
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

// Update User API OpenAI
router.post(
    '/updateUserApiOpenai',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { apiKeyOpenai } = req.body;

            let apiKeyOpenaiValid = false;

            // Validate OpenAI API key
            if (apiKeyOpenai !== '') {
                try {
                    const config: AxiosRequestConfig = {
                        method: 'post',
                        url: 'https://api.openai.com/v1/chat/completions',
                        headers: {
                            'Authorization': `Bearer ${apiKeyOpenai}`,
                            'Content-Type': 'application/json'
                        },
                        data: {
                            model: 'gpt-3.5-turbo',
                            messages: [
                                {
                                    role: 'user',
                                    content: 'Hello'
                                }
                            ],
                            max_tokens: 10
                        },
                        timeout: 10000, // 10 second timeout
                    };

                    const response: AxiosResponse = await axios.request(config);
                    if (response.status === 200 && response.data.choices && response.data.choices.length > 0) {
                        apiKeyOpenaiValid = true;
                    }
                } catch (error) {
                    console.error('OpenAI API key validation failed:', error);
                    apiKeyOpenaiValid = false;
                }
            }

            if (!apiKeyOpenaiValid) {
                return res.status(400).json({ message: 'Invalid API Key' });
            }

            const updatedUser = await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    apiKeyOpenai: apiKeyOpenai,
                    apiKeyOpenaiValid: apiKeyOpenaiValid,
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

// Update User API LocalAI
router.post(
    '/updateUserApiLocalai',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { apiKeyLocalaiEndpoint, apiKeyLocalai } = req.body;

            let apiKeyLocalaiValid = false;

            // Validate LocalAI endpoint
            if (apiKeyLocalaiEndpoint !== '') {
                try {
                    const headers: any = {};
                    if (apiKeyLocalai && apiKeyLocalai.trim() !== '') {
                        headers['Authorization'] = `Bearer ${apiKeyLocalai}`;
                    }

                    const config: AxiosRequestConfig = {
                        method: 'get',
                        url: `${apiKeyLocalaiEndpoint}/v1/models`,
                        headers: headers,
                        timeout: 10000, // 10 second timeout
                    };

                    const response: AxiosResponse = await axios.request(config);
                    console.log('response: ', response?.data);
                    if (response?.data && Array.isArray(response?.data?.data) && response?.data?.data.length >= 0) {
                        apiKeyLocalaiValid = true;
                    }
                } catch (error) {
                    console.error('LocalAI endpoint validation failed:', error);
                    apiKeyLocalaiValid = false;
                }
            }

            if (!apiKeyLocalaiValid) {
                return res.status(400).json({ message: 'Invalid endpoint or API key' });
            }

            const updatedUser = await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    apiKeyLocalaiValid: apiKeyLocalaiValid,
                    apiKeyLocalaiEndpoint: apiKeyLocalaiEndpoint,
                    apiKeyLocalai: apiKeyLocalai || '',
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

type TTelegramChat = {
    chatId: string;
    messageThreadId: number | null;
    label: string;
    type: string;
};

function labelForTelegramChat(chat: Record<string, unknown>): {
    label: string;
    type: string;
} {
    const id = String(chat.id);
    let type = 'unknown';
    if (typeof chat.type === 'string') {
        type = chat.type;
    }
    let label: string;
    if (typeof chat.title === 'string' && chat.title.length >= 1) {
        label = chat.title;
    } else {
        let fn = '';
        if (typeof chat.first_name === 'string') {
            fn = chat.first_name;
        }
        let ln = '';
        if (typeof chat.last_name === 'string') {
            ln = chat.last_name;
        }
        const name = `${fn} ${ln}`.trim();
        let un = '';
        if (typeof chat.username === 'string') {
            un = chat.username;
        }
        if (name && un) {
            label = `${name} (@${un})`;
        } else if (name) {
            label = name;
        } else if (un) {
            label = `@${un}`;
        } else {
            label = id;
        }
    }
    return { label: `${label} · ${type}`, type };
}

/** Topic title when Telegram includes it on the message (forum_topic or forum_topic_created) */
function forumTopicTitleFromMessage(m: Record<string, unknown>): string | null {
    const ft = m.forum_topic;
    if (ft && typeof ft === 'object') {
        const name = (ft as Record<string, unknown>).name;
        if (typeof name === 'string' && name.trim().length >= 1) {
            return name.trim();
        }
    }
    const ftc = m.forum_topic_created;
    if (ftc && typeof ftc === 'object') {
        const name = (ftc as Record<string, unknown>).name;
        if (typeof name === 'string' && name.trim().length >= 1) {
            return name.trim();
        }
    }
    return null;
}

/** One row per chat, or per (supergroup + forum topic) so you can target a specific “channel” inside a forum */
function collectChatsFromTelegramUpdates(
    updates: unknown[]
): TTelegramChat[] {
    const map = new Map<string, TTelegramChat>();

    const pushFromMessageLike = (o: unknown) => {
        if (!o || typeof o !== 'object') return;
        const m = o as Record<string, unknown>;
        const chat = m.chat;
        if (!chat || typeof chat !== 'object') return;
        const c = chat as Record<string, unknown>;
        if (typeof c.id === 'undefined' || c.id === null) return;
        const chatId = String(c.id);
        const mt = m.message_thread_id;
        let messageThreadId: number | null = null;
        if (typeof mt === 'number' && mt > 0) {
            messageThreadId = mt;
        }
        let threadKey = '';
        if (messageThreadId != null) {
            threadKey = String(messageThreadId);
        }
        const key = `${chatId}:::${threadKey}`;
        const { label: baseLabel, type } = labelForTelegramChat(c);
        let topicBit = '';
        if (messageThreadId != null) {
            const topicTitle = forumTopicTitleFromMessage(m);
            if (topicTitle) {
                topicBit = ` · ${topicTitle} (topic ${messageThreadId})`;
            } else {
                topicBit = ` · topic ${messageThreadId}`;
            }
        }
        const fullLabel = `${baseLabel}${topicBit}`;
        const prev = map.get(key);
        if (prev) {
            const titleNow = forumTopicTitleFromMessage(m);
            if (titleNow) {
                map.set(key, {
                    chatId,
                    messageThreadId,
                    label: `${baseLabel} · ${titleNow} (topic ${messageThreadId})`,
                    type,
                });
            }
            return;
        }
        map.set(key, {
            chatId,
            messageThreadId,
            label: fullLabel,
            type,
        });
    };

    for (const u of updates) {
        if (!u || typeof u !== 'object') continue;
        const up = u as Record<string, unknown>;
        pushFromMessageLike(up.message);
        pushFromMessageLike(up.edited_message);
        pushFromMessageLike(up.channel_post);
        if (up.chat_join_request && typeof up.chat_join_request === 'object') {
            const cjr = up.chat_join_request as Record<string, unknown>;
            if (cjr.chat) pushFromMessageLike({ chat: cjr.chat });
        }
        const cq = up.callback_query;
        if (cq && typeof cq === 'object') {
            pushFromMessageLike((cq as Record<string, unknown>).message);
        }
        if (up.my_chat_member && typeof up.my_chat_member === 'object') {
            const x = up.my_chat_member as Record<string, unknown>;
            if (x.chat) pushFromMessageLike({ chat: x.chat });
        }
        if (up.chat_member && typeof up.chat_member === 'object') {
            const x = up.chat_member as Record<string, unknown>;
            if (x.chat) pushFromMessageLike({ chat: x.chat });
        }
    }

    return Array.from(map.values()).sort((a, b) =>
        a.label.localeCompare(b.label)
    );
}

function normalizeCachedTelegramChat(raw: unknown): TTelegramChat | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    let chatId = '';
    if (typeof o.chatId === 'string') {
        chatId = o.chatId;
    } else if (typeof o.id === 'string') {
        chatId = o.id;
    }
    if (!chatId) return null;
    let label = chatId;
    if (typeof o.label === 'string') {
        label = o.label;
    }
    let type = 'unknown';
    if (typeof o.type === 'string') {
        type = o.type;
    }
    const mt = o.messageThreadId;
    let messageThreadId: number | null = null;
    if (typeof mt === 'number' && mt > 0) {
        messageThreadId = mt;
    }
    return { chatId, messageThreadId, label, type };
}

/** Bot token for Telegram APIs: JWT session identifies the user; token only from DB */
async function getTelegramBotTokenFromDbOnly(
    authUsername: string
): Promise<{ token: string; error: string }> {
    const keys = await ModelUserApiKey.findOne({
        username: authUsername,
    })
        .select('telegramBotToken')
        .lean();
    let stored = '';
    if (typeof keys?.telegramBotToken === 'string') {
        stored = keys.telegramBotToken.trim();
    }
    if (stored) {
        return { token: stored, error: '' };
    }
    return {
        token: '',
        error:
            'No bot token stored for your account. Paste your token above and click “Save bot token”, or use “Send test message and save” once.',
    };
}

// Store bot token only (getMe check) so telegramListRecentChats can run before picking a chat
router.post(
    '/telegramSaveBotToken',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            let raw = '';
            if (typeof req.body?.telegramBotToken === 'string') {
                raw = req.body.telegramBotToken.trim();
            }
            if (!raw) {
                return res.status(400).json({
                    success: '',
                    error: 'telegramBotToken is required',
                });
            }

            const url = `https://api.telegram.org/bot${raw}/getMe`;
            const tgRes = await axios.get<{
                ok: boolean;
                description?: string;
            }>(url, { timeout: 15_000 });

            if (!tgRes.data?.ok) {
                let errInvalid = 'Invalid bot token';
                if (typeof tgRes.data?.description === 'string') {
                    errInvalid = tgRes.data.description;
                }
                return res.status(400).json({
                    success: '',
                    error: errInvalid,
                });
            }

            await ModelUserApiKey.findOneAndUpdate(
                { username: res.locals.auth_username },
                { $set: { telegramBotToken: raw } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            return res.json({
                success: 'Updated',
                error: '',
            });
        } catch (error) {
            console.error(error);
            if (isAxiosError(error) && error.response?.data) {
                const data = error.response.data as { description?: string };
                let errReach = 'Failed to reach Telegram API';
                if (typeof data?.description === 'string') {
                    errReach = data.description;
                }
                return res.status(400).json({
                    success: '',
                    error: errReach,
                });
            }
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Cached conversation list (MongoDB); restores dropdown after refresh
router.post(
    '/telegramGetCachedChats',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const username = res.locals.auth_username;
            const [cacheDoc, apiKeys] = await Promise.all([
                ModelUserTelegramConversationCache.findOne({ username }).lean(),
                ModelUserApiKey.findOne({ username })
                    .select('telegramChatId telegramMessageThreadId telegramBotToken')
                    .lean(),
            ]);

            const hasTelegramBotToken =
                typeof apiKeys?.telegramBotToken === 'string' &&
                apiKeys.telegramBotToken.trim().length >= 1;

            let rawList: unknown[] = [];
            if (Array.isArray(cacheDoc?.chats)) {
                rawList = cacheDoc.chats;
            }
            const chats: TTelegramChat[] = [];
            for (const row of rawList) {
                const n = normalizeCachedTelegramChat(row);
                if (n) chats.push(n);
            }

            const savedThr = apiKeys?.telegramMessageThreadId;
            let savedMessageThreadId: number | null = null;
            if (typeof savedThr === 'number' && savedThr > 0) {
                savedMessageThreadId = savedThr;
            }

            let savedChatId = '';
            if (typeof apiKeys?.telegramChatId === 'string') {
                savedChatId = apiKeys.telegramChatId;
            }

            return res.json({
                success: 'ok',
                error: '',
                chats,
                hasTelegramBotToken,
                savedChatId,
                savedMessageThreadId,
                updatedAtUtc: cacheDoc?.updatedAtUtc ?? null,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// List chats the bot has recently seen (getUpdates); persists to userTelegramConversationCache
router.post(
    '/telegramListRecentChats',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
            const { token, error: tokenErr } = await getTelegramBotTokenFromDbOnly(
                res.locals.auth_username
            );
            if (!token) {
                return res.status(400).json({
                    success: '',
                    error: tokenErr,
                    chats: [] as TTelegramChat[],
                });
            }

            const url = `https://api.telegram.org/bot${token}/getUpdates`;
            const tgRes = await axios.get<{
                ok: boolean;
                result?: unknown[];
                description?: string;
            }>(url, { params: { limit: 100 }, timeout: 15_000 });

            if (!tgRes.data?.ok) {
                let apiErr = 'Telegram API error';
                if (typeof tgRes.data?.description === 'string') {
                    apiErr = tgRes.data.description;
                }
                return res.status(400).json({
                    success: '',
                    error: apiErr,
                    chats: [] as TTelegramChat[],
                });
            }

            let updates: unknown[] = [];
            if (Array.isArray(tgRes.data.result)) {
                updates = tgRes.data.result;
            }
            const chats = collectChatsFromTelegramUpdates(updates);
            const username = res.locals.auth_username;
            const updatedAtUtc = new Date();

            // Remove all prior cache rows for this user (including duplicates), then insert only what Telegram returned now
            await ModelUserTelegramConversationCache.deleteMany({ username });
            await ModelUserTelegramConversationCache.create({
                username,
                chats,
                updatedAtUtc,
            });

            return res.json({
                success: 'ok',
                error: '',
                chats,
            });
        } catch (error) {
            console.error(error);
            if (isAxiosError(error) && error.response?.data) {
                const data = error.response.data as { description?: string };
                let errReach2 = 'Failed to reach Telegram API';
                if (typeof data?.description === 'string') {
                    errReach2 = data.description;
                }
                return res.status(400).json({
                    success: '',
                    error: errReach2,
                    chats: [] as TTelegramChat[],
                });
            }
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Update User Telegram (Bot token + chat id; sends a test message before saving)
router.post(
    '/updateUserApiTelegram',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const {
                telegramBotToken,
                telegramChatId,
                telegramMessageThreadId,
                useStoredToken,
            } = req.body as {
                telegramBotToken?: string;
                telegramChatId?: string;
                telegramMessageThreadId?: number | null;
                useStoredToken?: boolean;
            };

            let token = '';
            if (typeof telegramBotToken === 'string') {
                token = telegramBotToken.trim();
            }
            let chatId = '';
            if (typeof telegramChatId === 'string') {
                chatId = telegramChatId.trim();
            }
            let messageThreadId: number | null = null;
            if (
                typeof telegramMessageThreadId === 'number' &&
                telegramMessageThreadId > 0
            ) {
                messageThreadId = telegramMessageThreadId;
            }

            if (!token && useStoredToken === true) {
                const keys = await ModelUserApiKey.findOne({
                    username: res.locals.auth_username,
                })
                    .select('telegramBotToken')
                    .lean();
                if (typeof keys?.telegramBotToken === 'string') {
                    token = keys.telegramBotToken.trim();
                }
            }

            if (!token || !chatId) {
                return res.status(400).json({
                    success: '',
                    error:
                        'telegramChatId is required. Paste the bot token, or save Telegram once so the server can reuse it.',
                });
            }

            const testText =
                'AI Notes XYZ: Telegram notifications are configured successfully.';
            const url = `https://api.telegram.org/bot${token}/sendMessage`;
            const sendPayload: Record<string, unknown> = {
                chat_id: chatId,
                text: testText,
            };
            if (messageThreadId != null) {
                sendPayload.message_thread_id = messageThreadId;
            }
            const tgRes = await axios.post<{ ok: boolean; description?: string }>(
                url,
                sendPayload,
                { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 }
            );

            if (!tgRes.data?.ok) {
                let rejectErr = 'Telegram API rejected the request';
                if (typeof tgRes.data?.description === 'string') {
                    rejectErr = tgRes.data.description;
                }
                return res.status(400).json({
                    success: '',
                    error: rejectErr,
                });
            }

            await ModelUserApiKey.findOneAndUpdate(
                { username: res.locals.auth_username },
                {
                    telegramValid: true,
                    telegramBotToken: token,
                    telegramChatId: chatId,
                    telegramMessageThreadId: messageThreadId,
                },
                { new: true }
            );

            return res.json({
                success: 'Updated',
                error: '',
            });
        } catch (error) {
            console.error(error);
            if (isAxiosError(error) && error.response?.data) {
                const data = error.response.data as { description?: string };
                let errReach3 = 'Failed to reach Telegram API';
                if (typeof data?.description === 'string') {
                    errReach3 = data.description;
                }
                return res.status(400).json({
                    success: '',
                    error: errReach3,
                });
            }
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

// Clear User API Key
router.post(
    '/clearUserApiKey',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { apiKeyType } = req.body;

            if (typeof apiKeyType !== 'string') {
                return res.status(400).json({
                    success: '',
                    error: 'Invalid API key type',
                });
            }

            const validApiKeyTypes = [
                'groq', 'openrouter', 's3', 'ollama', 'qdrant',
                'replicate', 'runpod', 'openai', 'localai', 'smtp', 'telegram'
            ];

            if (!validApiKeyTypes.includes(apiKeyType)) {
                return res.status(400).json({
                    success: '',
                    error: 'Invalid API key type',
                });
            }

            // Define clear operations for each API key type
            const clearOperations: Record<string, any> = {
                groq: {
                    apiKeyGroq: '',
                    apiKeyGroqValid: false,
                },
                openrouter: {
                    apiKeyOpenrouter: '',
                    apiKeyOpenrouterValid: false,
                },
                s3: {
                    apiKeyS3Valid: false,
                    apiKeyS3AccessKeyId: '',
                    apiKeyS3BucketName: '',
                    apiKeyS3Endpoint: '',
                    apiKeyS3Region: '',
                    apiKeyS3SecretAccessKey: '',
                },
                ollama: {
                    apiKeyOllamaValid: false,
                    apiKeyOllamaEndpoint: '',
                },
                qdrant: {
                    apiKeyQdrantValid: false,
                    apiKeyQdrantEndpoint: '',
                    apiKeyQdrantPassword: '',
                },
                replicate: {
                    apiKeyReplicate: '',
                    apiKeyReplicateValid: false,
                },
                runpod: {
                    apiKeyRunpod: '',
                    apiKeyRunpodValid: false,
                },
                openai: {
                    apiKeyOpenai: '',
                    apiKeyOpenaiValid: false,
                },
                localai: {
                    apiKeyLocalaiValid: false,
                    apiKeyLocalaiEndpoint: '',
                    apiKeyLocalai: '',
                },
                smtp: {
                    smtpValid: false,
                    smtpHost: '',
                    smtpPort: '',
                    smtpUser: '',
                    smtpPassword: '',
                    smtpFrom: '',
                },
                telegram: {
                    telegramValid: false,
                    telegramBotToken: '',
                    telegramChatId: '',
                    telegramMessageThreadId: null,
                },
            };

            const updateFields = clearOperations[apiKeyType];

            if (!updateFields) {
                return res.status(400).json({
                    success: '',
                    error: 'Unsupported API key type',
                });
            }

            await ModelUserApiKey.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                updateFields,
                {
                    new: true
                }
            );

            // Clear Telegram conversation cache
            if (apiKeyType === 'telegram') {
                await ModelUserTelegramConversationCache.deleteOne({
                    username: res.locals.auth_username,
                });
            }

            return res.json({
                success: 'API Key cleared successfully',
                error: '',
            });
        } catch (error) {
            console.error('Error clearing API key:', error);
            return res.status(500).json({
                success: '',
                error: 'Server error while clearing API key',
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