import { Router, Request, Response } from 'express';
import { ModelChatLlm } from '../../../schema/SchemaChatLlm.schema';
import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import fetchLlmGroqVision from './utils/callLlmGroqVision';
import { getFileFromS3R2 } from '../../../utils/files/s3R2GetFile';
import fetchLlmGroqAudio from './utils/callLlmGroqAudio';
import { GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import mongoose, { ObjectId } from 'mongoose';
import callLlmGroqTextTags from './utils/callLlmGroqTextTags';
import getNextMessageFromLast30Conversation from './utils/getNextMessageFromLast25Conversation';
import { getApiKeyByObject } from '../../../utils/llm/llmCommonFunc';
import { normalizeDateTimeIpAddress } from '../../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../../middleware/middlewareActionDatetime';

// Router
const router = Router();

const generateTags = async ({
    mongodbRecordId,
    content,

    llmAuthToken,
    provider,
}: {
    mongodbRecordId: string,
    content: string,

    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}) => {
    try {
        // generate tags
        let argContentTags = `${content}`;
        const resultTags = await callLlmGroqTextTags({
            argContent: argContentTags,

            llmAuthToken: llmAuthToken,
            provider,
        })
        if (resultTags.length >= 1) {
            await ModelChatLlm.findOneAndUpdate(
                {
                    _id: mongodbRecordId,
                },
                {
                    $set: {
                        tags: resultTags
                    }
                },
                {
                    new: true
                }
            );
        }
    } catch (error) {
        console.error(error);
    }
}

// Add Note API
router.post(
    '/notesAdd',
    middlewareUserAuth,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        try {
            const { type, content, tags, fileUrl, fileUrlArr } = req.body; // Added threadId
            const apiKeys = getApiKeyByObject(res.locals.apiKey);

            // variable -> threadId
            let threadId = null as mongoose.Types.ObjectId | null;
            const arg_threadId = req.body.threadId;
            if (typeof req.body?.threadId === 'string') {
                threadId = req.body?.threadId ? mongoose.Types.ObjectId.createFromHexString(arg_threadId) : null;
            }
            if (threadId === null) {
                return res.status(400).json({ message: 'Thread ID cannot be null' });
            }

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
                            if (provider === 'groq' || provider === 'openrouter') {
                                await generateTags({
                                    mongodbRecordId: (newNote._id as ObjectId).toString(),
                                    content: contentAi,

                                    provider,
                                    llmAuthToken,
                                });
                                // add tags
                                await generateTags({
                                    mongodbRecordId: (result._id as ObjectId).toString(),
                                    content: contentAi,

                                    provider,
                                    llmAuthToken,
                                });
                            }

                            // add notes from last 25 conversations
                            if (provider === 'groq' || provider === 'openrouter') {
                                const nextMessage = await getNextMessageFromLast30Conversation({
                                    // identification
                                    threadId,
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
                                if (provider === 'groq' || provider === 'openrouter') {
                                    await generateTags({
                                        mongodbRecordId: (resultFromLastConversation._id as ObjectId).toString(),
                                        content: content,

                                        provider,
                                        llmAuthToken,
                                    });
                                }
                            }
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
                            if (provider === 'groq' || provider === 'openrouter') {
                                await generateTags({
                                    mongodbRecordId: (newNoteAudio._id as ObjectId).toString(),
                                    content: contentAudio,

                                    provider,
                                    llmAuthToken,
                                });
                            }

                            // add notes from last 25 conversations
                            if (provider === 'groq' || provider === 'openrouter') {
                                const nextMessage = await getNextMessageFromLast30Conversation({
                                    // identification
                                    threadId,
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
                                if (provider === 'groq' || provider === 'openrouter') {
                                    await generateTags({
                                        mongodbRecordId: (resultFromLastConversation._id as ObjectId).toString(),
                                        content: content,

                                        provider,
                                        llmAuthToken,
                                    });
                                }
                            }
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
                if (provider === 'groq' || provider === 'openrouter') {
                    await generateTags({
                        mongodbRecordId: (newNote._id as ObjectId).toString(),
                        content: content,

                        provider,
                        llmAuthToken,
                    });
                }

                // add notes
                if (provider === 'groq' || provider === 'openrouter') {
                    const nextMessage = await getNextMessageFromLast30Conversation({
                        // identification
                        threadId,
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
                    if (provider === 'groq' || provider === 'openrouter') {
                        await generateTags({
                            mongodbRecordId: (resultFromLastConversation._id as ObjectId).toString(),
                            content: content,

                            provider,
                            llmAuthToken,
                        });
                    }
                }
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