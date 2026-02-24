import { Router, Request, Response } from 'express';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import fetchLlmUnified from '../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getFile, S3Config } from '../../../utils/upload/uploadFunc';
import fetchAudioUnified from '../../../utils/llmPendingTask/utils/fetchAudioUnified';
import { ObjectId } from 'mongoose';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';
import { ModelLlmPendingTaskCron } from '../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';
import { ModelUserApiKey } from '../../../schema/schemaUser/SchemaUserApiKey.schema';

import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import XLSX from 'xlsx';

// Router
const router = Router();

const generateTags = async ({
    mongodbRecordId,
    auth_username,
}: {
    mongodbRecordId: string,
    auth_username: string,
}) => {
    try {
        await ModelLlmPendingTaskCron.create({
            username: auth_username,
            taskType: llmPendingTaskTypes.page.featureAiActions.chatMessage,
            targetRecordId: mongodbRecordId,
        });
    } catch (error) {
        console.error(error);
    }
};

const getContentFromDocument = async ({
    fileUrl,
    apiKeys,
    username,
}: {
    fileUrl: string;
    apiKeys: any;
    username: string;
}) => {
    const extension = fileUrl.split('.').pop();

    try {
        const userApiKeyDb = await ModelUserApiKey.findOne({ username });

        const s3Config: S3Config = {
            region: apiKeys.apiKeyS3Region,
            endpoint: apiKeys.apiKeyS3Endpoint,
            accessKeyId: apiKeys.apiKeyS3AccessKeyId,
            secretAccessKey: apiKeys.apiKeyS3SecretAccessKey,
            bucketName: apiKeys.apiKeyS3BucketName,
        };

        const fileResult = await getFile({
            fileName: fileUrl,
            storageType: userApiKeyDb?.fileStorageType === 's3' ? 's3' : 'gridfs',
            s3Config: userApiKeyDb?.fileStorageType === 's3' ? s3Config : undefined,
        });

        if (fileResult.success && fileResult.content) {
            const buffer = fileResult.content;

            let extractedText = '' as string;
            const ext = (extension || '').toLowerCase();

            if (['md', 'markdown', 'txt', 'csv', 'json', 'log'].includes(ext)) {
                extractedText = buffer.toString('utf-8');
            } else if (ext === 'pdf') {
                try {
                    let bufferArray = new Uint8Array(buffer.buffer);
                    const parser = new PDFParse({ data: bufferArray });
                    const pdfRes = await parser.getText();
                    extractedText = pdfRes?.text || '';
                    await parser.destroy();
                } catch (err) {
                    console.error(err);
                    extractedText = '';
                }
            } else if (ext === 'docx') {
                try {
                    const resultDoc = await mammoth.extractRawText({ buffer });
                    extractedText = resultDoc?.value || '';
                } catch (err) {
                    extractedText = '';
                }
            } else if (ext === 'xlsx' || ext === 'xls') {
                try {
                    const wb = XLSX.read(buffer, { type: 'buffer' });
                    let acc = '' as string;
                    for (const sheetName of wb.SheetNames) {
                        const ws = wb.Sheets[sheetName];
                        if (!ws) continue;
                        const csv = XLSX.utils.sheet_to_csv(ws);
                        if (csv && csv.trim().length > 0) {
                            acc += `\n\n### Sheet: ${sheetName}\n` + csv;
                        }
                    }
                    extractedText = acc.trim();
                } catch (err) {
                    extractedText = '';
                }
            } else {
                // Other file types not parsed to text here
                extractedText = '';
            }

            return extractedText;
        }

        return '';
    } catch (error) {
        console.error(error);
        return '';
    }
};

const handleUploadTypeDocument = async ({
    fileUrl,
    apiKeys,
    content,
    type,
    tags,
    threadId,
    actionDatetimeObj,
    auth_username,
}: {
    fileUrl: string;
    apiKeys: any;
    content: string;
    type: string;
    tags: any;
    threadId: any;
    actionDatetimeObj: any;
    auth_username: string;
}): Promise<{
    success: boolean;
    doc?: any;
}> => {
    try {

        // Use extracted text via utility
        const extractedText = await getContentFromDocument({
            fileUrl,
            apiKeys,
            username: auth_username,
        });

        if (!extractedText || extractedText.length < 1) {
            return {
                success: false,
            };
        }

        // Cap to avoid oversized records
        const MAX_CHARS = 200000; // ~200k chars preview
        const truncated = extractedText.length > MAX_CHARS ? extractedText.slice(0, MAX_CHARS) : extractedText;

        // create base record
        const result = await ModelChatLlm.create({
            type,
            content,
            username: auth_username,
            tags,
            fileUrl,
            fileContentText: extractedText,
            fileUrlArr: '',
            threadId,
            fileContentAi: '',
            ...actionDatetimeObj,
        });

        await generateTags({
            mongodbRecordId: result._id.toString(),
            auth_username,
        });

        // generate Feature AI Actions by source id
        await ModelLlmPendingTaskCron.create({
            username: auth_username,
            taskType: llmPendingTaskTypes.page.featureAiActions.chatMessage,
            targetRecordId: result._id,
        });

        return {
            success: true,
            doc: result,
        };
    } catch (error) {
        console.error(error);
        return {
            success: false,
        };
    }
};

// Add Note API
router.post(
    '/notesAdd',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const auth_username = res.locals.auth_username;
            const { type, content, tags, fileUrl, fileUrlArr } = req.body; // Added threadId
            const apiKeys = getApiKeyByObject(res.locals.apiKey);

            // variable -> threadId
            let threadId = getMongodbObjectOrNull(req.body.threadId);
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

            // get thread info
            const threadInfo = await ModelChatLlmThread.findOne({
                _id: threadId,
                username: auth_username,
            });
            if (!threadInfo) {
                return res.status(400).json({ message: 'Thread not found' });
            }

            // does thread have personal context enabled?
            const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);

            // get date utc str as YYYY-MM
            if (type === 'image') {
                const result = await ModelChatLlm.create({
                    type,
                    content,
                    username: res.locals.auth_username,
                    tags,
                    fileUrl,
                    fileUrlArr,
                    threadId, // Added threadId here

                    ...actionDatetimeObj,
                });

                // get image
                const userApiKeyDb = await ModelUserApiKey.findOne({ username: res.locals.auth_username });

                const s3Config: S3Config = {
                    region: apiKeys.apiKeyS3Region,
                    endpoint: apiKeys.apiKeyS3Endpoint,
                    accessKeyId: apiKeys.apiKeyS3AccessKeyId,
                    secretAccessKey: apiKeys.apiKeyS3SecretAccessKey,
                    bucketName: apiKeys.apiKeyS3BucketName,
                };

                const resultImage = await getFile({
                    fileName: fileUrl,
                    storageType: userApiKeyDb?.fileStorageType === 's3' ? 's3' : 'gridfs',
                    s3Config: userApiKeyDb?.fileStorageType === 's3' ? s3Config : undefined,
                });

                if (resultImage.success && resultImage.content) {
                    const imageBase64 = resultImage.content.toString('base64');

                    let contentAi = '';
                    let modelName = '';
                    let llmAuthToken = '';
                    let imageProvider = '' as 'groq' | 'openrouter';

                    if (apiKeys.apiKeyGroqValid) {
                        imageProvider = 'groq';
                        llmAuthToken = apiKeys.apiKeyGroq;
                        modelName = 'meta-llama/llama-4-scout-17b-16e-instruct';
                    } else if (apiKeys.apiKeyOpenrouterValid) {
                        imageProvider = 'openrouter';
                        llmAuthToken = apiKeys.apiKeyOpenrouter;
                        modelName = 'mistralai/ministral-8b-2512';
                    }

                    if (imageProvider === 'groq' || imageProvider === 'openrouter') {
                        const resultLlm = await fetchLlmUnified({
                            provider: imageProvider,
                            apiKey: llmAuthToken,
                            apiEndpoint: '',
                            model: modelName,
                            messages: [
                                { role: 'system', content: 'You are a helpful assistant.' },
                                { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }] },
                            ],
                        });

                        contentAi = resultLlm.success ? resultLlm.content : '';
                    }

                    if (contentAi.length >= 1) {
                        await ModelChatLlm.findOneAndUpdate(
                            { _id: result._id },
                            {
                                $set: {
                                    fileContentAi: contentAi,
                                }
                            }
                        );

                        // add tags
                        await generateTags({
                            mongodbRecordId: result._id.toString(),
                            auth_username,
                        });
                    }
                }

                return res.status(201).json(result);
            }

            if (type === 'audio') {
                console.log('type is audio');
                // type is audio
                const result = await ModelChatLlm.create({
                    type,
                    content,
                    username: res.locals.auth_username,
                    tags,
                    fileUrl,
                    fileUrlArr,
                    threadId, // Added threadId here

                    ...actionDatetimeObj,
                });

                return res.status(201).json(result);
            }

            if (type === 'text') {
                const newNote = await ModelChatLlm.create({
                    type,
                    content,
                    username: res.locals.auth_username,
                    tags,
                    fileUrl,
                    fileUrlArr,
                    threadId, // Added threadId here

                    ...actionDatetimeObj,
                });
                // add tags
                await generateTags({
                    mongodbRecordId: newNote._id.toString(),
                    auth_username,
                });

                // generate keywords by id
                await ModelLlmPendingTaskCron.create({
                    username: auth_username,
                    taskType: llmPendingTaskTypes.page.featureAiActions.chatMessage,
                    targetRecordId: newNote._id,
                });

                return res.status(201).json(newNote);
            }

            if (type === 'document') {
                const result = await handleUploadTypeDocument({
                    fileUrl,
                    apiKeys,
                    content,
                    type,
                    tags,
                    threadId,
                    actionDatetimeObj,
                    auth_username,
                });
                if (result.success === false) {
                    return res.status(400).json({ message: 'Failed to add file as file type not supported' });
                }
                return res.status(201).json(result.doc);
            }

            return res.status(500).json({ message: 'Unexpected error occurred' });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;