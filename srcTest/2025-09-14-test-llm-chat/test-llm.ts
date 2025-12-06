import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";

import fetchLlmUnified from "../../src/utils/llmPendingTask/utils/fetchLlmUnified";
import { ModelUserApiKey } from "../../src/schema/schemaUser/SchemaUserApiKey.schema";
import { getFileFromS3R2 } from "../../src/utils/files/s3R2GetFile";

const init = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);

        const userApiKey = await ModelUserApiKey.findOne({
            username: 'exampleuser',
        });

        if (!userApiKey) {
            throw new Error('User API key not found');
        }

        // image
        const resultImage = await getFileFromS3R2({
            fileName: 'ai-notes-xyz/testuser/chat/chat-thread-507f1f77bcf86cd799439011/messages/chat-507f191e810c19729de860ea.jpeg',
            userApiKey: userApiKey,
        })
        const resultImageContent = await resultImage?.Body?.transformToByteArray();
        const resultImageContentString = resultImageContent ? Buffer.from(resultImageContent).toString('base64') : '';

        // audio
        const resultAudio = await getFileFromS3R2({
            fileName: 'ai-notes-xyz/testuser/chat/chat-thread-507f1f77bcf86cd799439011/messages/chat-507f191e810c19729de860eb.webm',
            userApiKey: userApiKey,
        })

        const resultAudioContent = await resultAudio?.Body?.transformToByteArray();
        const resultAudioContentString = resultAudioContent ? Buffer.from(resultAudioContent).toString('base64') : '';

        const result = await fetchLlmUnified({
            provider: 'openrouter',
            apiKey: userApiKey.apiKeyOpenrouter,
            apiEndpoint: '',
            model: 'google/gemini-2.5-flash',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${resultImageContentString}`,
                            }
                        },
                    ]
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'input_audio',
                            input_audio: {
                                data: resultAudioContentString, // Add base64 audio data here
                                format: 'wav', // Specify the audio format
                            }
                        },
                    ]
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Say about this image and audio and also user info'
                        }
                    ]
                },
            ],
        });

        console.log(result);
        console.log(result.content);

        await mongoose.disconnect();
    } catch (error) {
        console.error(error);
    }
}

init();

// npx ts-node -r dotenv/config ./srcTest/2025-09-14-test-llm-chat/test-llm.ts