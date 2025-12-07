import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";

import fetchLlmUnified from "../../src/utils/llmPendingTask/utils/fetchLlmUnified";
import { ModelUserApiKey } from "../../src/schema/schemaUser/SchemaUserApiKey.schema";
import { getFile, S3Config } from "../../src/utils/upload/uploadFunc";

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

        const s3Config: S3Config = {
            region: userApiKey.apiKeyS3Region,
            endpoint: userApiKey.apiKeyS3Endpoint,
            accessKeyId: userApiKey.apiKeyS3AccessKeyId,
            secretAccessKey: userApiKey.apiKeyS3SecretAccessKey,
            bucketName: userApiKey.apiKeyS3BucketName,
        };

        // image
        const resultImage = await getFile({
            fileName: 'ai-notes-xyz/testuser/chat/chat-thread-507f1f77bcf86cd799439011/messages/chat-507f191e810c19729de860ea.jpeg',
            storageType: userApiKey.fileStorageType === 's3' ? 's3' : 'gridfs',
            s3Config: userApiKey.fileStorageType === 's3' ? s3Config : undefined,
        });
        const resultImageContentString = resultImage.success && resultImage.content 
            ? resultImage.content.toString('base64') 
            : '';

        // audio
        const resultAudio = await getFile({
            fileName: 'ai-notes-xyz/testuser/chat/chat-thread-507f1f77bcf86cd799439011/messages/chat-507f191e810c19729de860eb.webm',
            storageType: userApiKey.fileStorageType === 's3' ? 's3' : 'gridfs',
            s3Config: userApiKey.fileStorageType === 's3' ? s3Config : undefined,
        });
        const resultAudioContentString = resultAudio.success && resultAudio.content 
            ? resultAudio.content.toString('base64') 
            : '';

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