import { ModelAiModelModality } from "../../schema/schemaDynamicData/SchemaAiModelModality.schema";
import { ModelUserApiKey } from "../../schema/schemaUser/SchemaUserApiKey.schema";
import fetchLlmUnified from "../llmPendingTask/utils/fetchLlmUnified";

const updateLlmModalModalityById = async ({
    modalIdString,
    provider,

    username,
}: {
    modalIdString: string;
    provider: string;

    username: string;
}) => {
    try {
        // validate provider
        if (provider === 'groq') {
            // error
        } else {
            return false;
        }

        // get user api key
        const userApiKey = await ModelUserApiKey.findOne({
            username: username,
        });
        if (!userApiKey) {
            return false;
        }

        // find if exists
        const resultModelModality = await ModelAiModelModality.findOne({
            provider: provider,
            modalIdString: modalIdString,
        });
        if (!resultModelModality) {
            return false;
        }

        // if not pending, return true
        if (resultModelModality.isInputModalityText !== 'pending') {
            return true;
        }

        // test text
        let isText = 'pending';
        let isImage = 'pending';
        let isAudio = 'false';
        let isVideo = 'false';

        // test text
        const resultText = await fetchLlmUnified({
            provider: 'groq',
            apiKey: userApiKey.apiKeyGroq,
            apiEndpoint: '',
            model: modalIdString,
            messages: [{
                role: 'user',
                content: 'What is the input modalities of the model?',
            }],
            temperature: 0,
            maxTokens: 1000,
            topP: 1,
        });
        console.log('resultText: ', resultText);

        if (resultText.success) {
            isText = resultText.content.length > 0 ? 'true' : 'false';
        } else {
            isText = 'false';
        }

        // test image
        const resultImage = await fetchLlmUnified({
            provider: 'groq',
            apiKey: userApiKey.apiKeyGroq,
            apiEndpoint: '',
            model: modalIdString,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: 'https://ai-notes.xyz/img/logoAiNotesXyz.png',
                            },
                        }
                    ]
                },
                {
                    role: 'user',
                    content: 'Describe this image?',
                }
            ],
        });
        console.log('resultImage: ', resultImage);
        if (resultImage.success) {
            isImage = resultImage.content.length > 0 ? 'true' : 'false';
        } else {
            isImage = 'false';
        }

        // insert
        await ModelAiModelModality.updateOne(
            {
            provider: 'groq',
            modalIdString: modalIdString,
            },
            {
                $set: {
                    isInputModalityText: isText,
                    isInputModalityImage: isImage,
                    isInputModalityAudio: isAudio,
                    isInputModalityVideo: isVideo,
                }
            }
        );

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default updateLlmModalModalityById;