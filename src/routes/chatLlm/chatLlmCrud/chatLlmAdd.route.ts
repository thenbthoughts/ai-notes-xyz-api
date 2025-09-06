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
                                argContent: "What's in the image",
                                imageBase64: `data:image/png;base64,${imageBase64}`,

                                llmAuthToken,
                                provider,
                            })
                        }

                        if (contentAi.length >= 1) {
                            const newNote = await ModelChatLlm.create({
                                type: 'text',
                                content: `Image desc:` + '\n' + `${contentAi}`,
                                username: res.locals.auth_username,
                                tags,
                                fileUrl: fileUrl,
                                fileUrlArr: '',
                                threadId, // Added threadId here

                                isAi: true,
                                aiModelProvider: 'groq',
                                aiModelName: 'meta-llama/llama-4-scout-17b-16e-instruct',

                                ...actionDatetimeObj,
                            });

                            // add tags
                            await generateTags({
                                mongodbRecordId: (newNote._id as ObjectId).toString(),
                                auth_username,
                            });
                            // add tags
                            await generateTags({
                                mongodbRecordId: (result._id as ObjectId).toString(),
                                auth_username,
                            });

                            // add notes from last 25 conversations
                            /*
                            if (provider === 'groq' || provider === 'openrouter') {
                                const nextMessage = await getNextMessageFromLast30Conversation({
                                    // identification
                                    threadId,
                                    threadInfo,
                                    username: res.locals.auth_username,

                                    userApiKey: apiKeys,
                                });
                                const resultFromLastConversation = await ModelChatLlm.create({
                                    type: 'text',
                                    content: `AI: ${nextMessage.nextMessage}`,
                                    username: res.locals.auth_username,
                                    tags: [],
                                    fileUrl: '',
                                    fileUrlArr: '',
                                    threadId, // Added threadId here

                                    // model name
                                    isAi: true,
                                    aiModelProvider: nextMessage.aiModelProvider,
                                    aiModelName: nextMessage.aiModelName,

                                    ...actionDatetimeObj,
                                });

                                // add tags
                                await generateTags({
                                    mongodbRecordId: (resultFromLastConversation._id as ObjectId).toString(),
                                    auth_username,
                                });
                            }
                            */
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

                if (resultAudio) {
                    const audioBufferT = await getCustomArrayBuffer(resultAudio);
                    if (audioBufferT) {
                        const buffer = Buffer.from(audioBufferT);

                        let contentAudioToText = '';
                        if (provider === 'groq' || provider === 'openrouter') {
                            contentAudioToText = await fetchLlmGroqAudio({
                                audioArrayBuffer: buffer,

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

                            /*
                            // add notes from last 25 conversations
                            if (provider === 'groq' || provider === 'openrouter') {
                                const nextMessage = await getNextMessageFromLast30Conversation({
                                    // identification
                                    threadId,
                                    threadInfo,
                                    username: res.locals.auth_username,

                                    userApiKey: apiKeys,
                                });
                                const resultFromLastConversation = await ModelChatLlm.create({
                                    type: 'text',
                                    content: `AI: ${nextMessage.nextMessage}`,
                                    username: res.locals.auth_username,
                                    tags: [],
                                    fileUrl: '',
                                    fileUrlArr: '',
                                    threadId, // Added threadId here

                                    // model name
                                    isAi: true,
                                    aiModelProvider: nextMessage.aiModelProvider,
                                    aiModelName: nextMessage.aiModelName,

                                    ...actionDatetimeObj,
                                });

                                // add tags
                                await generateTags({
                                    mongodbRecordId: (resultFromLastConversation._id as ObjectId).toString(),
                                    auth_username,
                                });
                            }
                            */
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

                /*
                // add notes
                if (provider === 'groq' || provider === 'openrouter') {
                    const nextMessage = await getNextMessageFromLast30Conversation({
                        // identification
                        threadId,
                        threadInfo,
                        username: res.locals.auth_username,

                        userApiKey: apiKeys,
                    });
                    const resultFromLastConversation = await ModelChatLlm.create({
                        type: 'text',
                        content: `AI: ${nextMessage.nextMessage}`,
                        username: res.locals.auth_username,
                        tags: [],
                        fileUrl: '',
                        fileUrlArr: '',
                        threadId, // Added threadId here

                        // model name
                        isAi: true,
                        aiModelProvider: nextMessage.aiModelProvider,
                        aiModelName: nextMessage.aiModelName,

                        ...actionDatetimeObj,
                    });
                    // add tags
                    await generateTags({
                        mongodbRecordId: (resultFromLastConversation._id as ObjectId).toString(),
                        auth_username,
                    });
                }
                */
                return res.status(201).json(newNote);
            }

            return res.status(500).json({ message: 'Unexpected error occurred' });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;