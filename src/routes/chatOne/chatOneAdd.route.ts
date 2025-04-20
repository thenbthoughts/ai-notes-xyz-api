import { Router, Request, Response } from 'express';
import { ModelChatOne } from '../../schema/SchemaChatOne.schema';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import fetchLlmGroqVision from './utils/callLlmGroqVision';
import { getFileFromS3R2 } from '../../utils/files/s3R2GetFile';
import fetchLlmGroqAudio from './utils/callLlmGroqAudio';
import { GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { ObjectId } from 'mongoose';
import callLlmGroqTextTags from './utils/callLlmGroqTextTags';
import getNextMessageFromLast30Conversation from './utils/getNextMessageFromLast25Conversation';
import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';

// Router
const router = Router();

const getCreateNoteDateTime = ({
    actionDatetime,
    timeZoneUtcOffset,
}: {
    actionDatetime: Date | null,
    timeZoneUtcOffset: number
}) => {
    // get date utc str as YYYY-MM
    let dateTimeUtc = new Date().toISOString();
    if (actionDatetime) {
        dateTimeUtc = actionDatetime.toISOString();
    }
    const curDateTimeLocal = new Date(
        dateTimeUtc
    ).valueOf() + (
        (timeZoneUtcOffset) + (30 * 60)
    ) * 1000;
    const paginationDateLocalYearMonthStr = new Date(
        curDateTimeLocal
    ).toISOString().slice(0, 7);
    const paginationDateLocalYearMonthDateStr = new Date(
        curDateTimeLocal
    ).toISOString().slice(0, 10);

    return {
        paginationDateLocalYearMonthStr,
        paginationDateLocalYearMonthDateStr,
    };
};

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
            await ModelChatOne.findOneAndUpdate(
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
            const { type, content, tags, fileUrl, fileUrlArr } = req.body;
            const apiKeys = getApiKeyByObject(res.locals.apiKey);

            let timeZoneUtcOffset = 330;
            if (typeof res.locals.timeZoneUtcOffset === 'number') {
                timeZoneUtcOffset = res.locals.timeZoneUtcOffset;
            }

            const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);
            const actionDatetimeOther = getCreateNoteDateTime({
                actionDatetime: actionDatetimeObj.updatedAtUtc,
                timeZoneUtcOffset,
            });

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
                const result = await ModelChatOne.create({
                    type,
                    content,
                    username: res.locals.auth_username,
                    tags,
                    fileUrl,
                    fileUrlArr,

                    ...actionDatetimeObj,
                    ...actionDatetimeOther,
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
                            const newNote = await ModelChatOne.create({
                                type: 'text',
                                content: `Image desc:` + '\n' + `${contentAi}`,
                                username: res.locals.auth_username,
                                tags,
                                fileUrl: fileUrl,
                                fileUrlArr: '',

                                isAi: true,
                                aiModelProvider: 'groq',
                                aiModelName: 'meta-llama/llama-4-scout-17b-16e-instruct',

                                ...actionDatetimeObj,
                                ...actionDatetimeOther,
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
                                    username: res.locals.auth_username,

                                    userApiKey: apiKeys,
                                });
                                const resultFromLastConversation = await ModelChatOne.create({
                                    type: 'text',
                                    content: `AI: ${nextMessage.nextMessage}`,
                                    username: res.locals.auth_username,
                                    tags: [],
                                    fileUrl: '',
                                    fileUrlArr: '',

                                    // model name
                                    isAi: true,
                                    aiModelProvider: nextMessage.aiModelProvider,
                                    aiModelName: nextMessage.aiModelName,

                                    ...actionDatetimeObj,
                                    ...actionDatetimeOther,
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
                const result = await ModelChatOne.create({
                    type,
                    content,
                    username: res.locals.auth_username,
                    tags,
                    fileUrl,
                    fileUrlArr,

                    ...actionDatetimeObj,
                    ...actionDatetimeOther,
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
                            const newNoteAudio = await ModelChatOne.create({
                                type: 'text',
                                content: contentAudio,
                                username: res.locals.auth_username,
                                tags,
                                fileUrl: fileUrl,
                                fileUrlArr: '',

                                // model name
                                isAi: true,
                                aiModelProvider: 'groq',
                                aiModelName: 'whisper-large-v3',

                                ...actionDatetimeObj,
                                ...actionDatetimeOther,
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
                                    username: res.locals.auth_username,

                                    userApiKey: apiKeys,
                                });
                                const resultFromLastConversation = await ModelChatOne.create({
                                    type: 'text',
                                    content: `AI: ${nextMessage.nextMessage}`,
                                    username: res.locals.auth_username,
                                    tags: [],
                                    fileUrl: '',
                                    fileUrlArr: '',

                                    // model name
                                    isAi: true,
                                    aiModelProvider: nextMessage.aiModelProvider,
                                    aiModelName: nextMessage.aiModelName,

                                    ...actionDatetimeObj,
                                    ...actionDatetimeOther,
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
                const newNote = await ModelChatOne.create({
                    type,
                    content,
                    username: res.locals.auth_username,
                    tags,
                    fileUrl,
                    fileUrlArr,

                    ...actionDatetimeObj,
                    ...actionDatetimeOther,
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
                        username: res.locals.auth_username,

                        userApiKey: apiKeys,
                    });
                    const resultFromLastConversation = await ModelChatOne.create({
                        type: 'text',
                        content: `AI: ${nextMessage.nextMessage}`,
                        username: res.locals.auth_username,
                        tags: [],
                        fileUrl: '',
                        fileUrlArr: '',

                        // model name
                        isAi: true,
                        aiModelProvider: nextMessage.aiModelProvider,
                        aiModelName: nextMessage.aiModelName,

                        ...actionDatetimeObj,
                        ...actionDatetimeOther,
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