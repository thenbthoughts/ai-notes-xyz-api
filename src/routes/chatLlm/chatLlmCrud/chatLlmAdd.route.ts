import { Router, Request, Response } from 'express';
import { ModelChatLlm } from '../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import fetchLlmGroqVision from './utils/callLlmGroqVision';
import { getFileFromS3R2 } from '../../../utils/files/s3R2GetFile';
import fetchLlmGroqAudio from './utils/callLlmGroqAudio';
import { GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { ObjectId } from 'mongoose';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';
import { ModelLlmPendingTaskCron } from '../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { llmPendingTaskTypes } from '../../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelChatLlmThread } from '../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { getMongodbObjectOrNull } from '../../../utils/common/getMongodbObjectOrNull';

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
            taskType: llmPendingTaskTypes.page.chat.generateChatTagsById,
            targetRecordId: mongodbRecordId,
        });
    } catch (error) {
        console.error(error);
    }
};

const getContentFromDocument = async ({
    fileUrl,
    apiKeys,
}: {
    fileUrl: string;
    apiKeys: any;
}) => {
    const extension = fileUrl.split('.').pop();

    try {
        const s3File = await getFileFromS3R2({
            fileName: fileUrl,
            userApiKey: apiKeys,
        });

        if (s3File && s3File.Body) {
            const stream = s3File.Body as Readable;
            const chunks: Uint8Array[] = [];
            await new Promise<void>((resolve, reject) => {
                stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
                stream.on('end', () => resolve());
                stream.on('error', () => reject());
            });

            // Concatenate all chunks into a single Buffer using set for proper typing
            const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
            const buffer = Buffer.alloc(totalLength);
            let offset = 0;
            for (const c of chunks) {
                buffer.set(c, offset);
                offset += c.length;
            }

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
            mongodbRecordId: (result._id as ObjectId).toString(),
            auth_username,
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

            let provider = '';
            let llmAuthToken = '';
            if (apiKeys.apiKeyGroqValid) {
                provider = 'groq';
                llmAuthToken = apiKeys.apiKeyGroq;
            } else if (apiKeys.apiKeyOpenrouterValid) {
                provider = 'openrouter';
                llmAuthToken = apiKeys.apiKeyOpenrouter;
            }

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
                const resultImage = await getFileFromS3R2({
                    fileName: fileUrl,
                    userApiKey: apiKeys,
                })

                if (resultImage) {
                    const imageString = await resultImage.Body?.transformToByteArray();
                    if (imageString) {
                        const imageBase64 = Buffer.from(imageString).toString('base64');

                        let contentAi = '';
                        if (provider === 'groq' || provider === 'openrouter') {
                            contentAi = await fetchLlmGroqVision({
                                argContent: "What's in the image? Explain in detail like victorian style but in simple words",
                                imageBase64: `data:image/png;base64,${imageBase64}`,

                                llmAuthToken,
                                provider,
                            })
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
                                mongodbRecordId: (result._id as ObjectId).toString(),
                                auth_username,
                            });
                        }
                    }
                }

                return res.status(201).json(result);
            }

            if (type === 'audio') {
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

                // get image
                const resultAudio = await getFileFromS3R2({
                    fileName: fileUrl,
                    userApiKey: apiKeys,
                })

                const getCustomArrayBuffer = async (response: GetObjectCommandOutput): Promise<ArrayBuffer | null> => {
                    // Step 2: Convert the stream (response.Body) to an ArrayBuffer
                    const stream = response.Body as Readable;

                    // Create an empty array to hold the chunks
                    const chunks: Uint8Array[] = [];

                    // Use the 'data' event to collect chunks from the stream
                    stream.on('data', (chunk: Uint8Array) => {
                        chunks.push(chunk); // Push each chunk to the array
                    });

                    // When the stream ends, concatenate the chunks and convert to ArrayBuffer
                    return new Promise((resolve, reject) => {
                        stream.on('end', () => {
                            // Concatenate all chunks into a single Buffer using set for proper typing
                            const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
                            const buffer = Buffer.alloc(totalLength);
                            let offset = 0;
                            for (const c of chunks) {
                                buffer.set(c, offset);
                                offset += c.length;
                            }
                            // Convert the Buffer to ArrayBuffer
                            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
                            resolve(arrayBuffer);
                        });

                        stream.on('error', (err) => {
                            reject(null);
                        });
                    });
                }

                if (resultAudio) {
                    const audioBufferT = await getCustomArrayBuffer(resultAudio);
                    if (audioBufferT) {
                        let contentAudioToText = '';
                        if (provider === 'groq' || provider === 'openrouter') {
                            contentAudioToText = await fetchLlmGroqAudio({
                                audioArrayBuffer: audioBufferT,

                                provider,
                                llmAuthToken,
                            })
                        }

                        if (contentAudioToText.length >= 1) {
                            const contentAudio = `Text to audio:` + '\n' + `${contentAudioToText.trim()}`
                            const newNoteAudio = await ModelChatLlm.create({
                                type: 'text',
                                content: contentAudio,
                                username: res.locals.auth_username,
                                tags,
                                fileUrl: fileUrl,
                                fileUrlArr: '',
                                threadId, // Added threadId here

                                // model name
                                isAi: true,
                                aiModelProvider: 'groq',
                                aiModelName: 'whisper-large-v3',

                                ...actionDatetimeObj,
                            });

                            // add tags
                            await generateTags({
                                mongodbRecordId: (newNoteAudio._id as ObjectId).toString(),
                                auth_username,
                            });
                        }
                    }
                }

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
                    mongodbRecordId: (newNote._id as ObjectId).toString(),
                    auth_username,
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
                if (result.success ===false) {
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