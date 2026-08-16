import axios from "axios";

import { ModelAiListGroq } from "../../../../schema/schemaDynamicData/SchemaGroqModel.schema";
import { ModelLlmPendingTaskCron } from "../../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema";
import { llmPendingTaskTypes } from "../../llmPendingTaskConstants";
import { ModelUserApiKey } from "../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelAiModelModality } from "../../../../schema/schemaDynamicData/SchemaAiModelModality.schema";

const groqModelGet = async ({
    userId,
    force,
}: {
    userId: string;
    force?: boolean;
}) => {
    try {
        // check if user is valid
        const userApiKey = await ModelUserApiKey.findOne({
            userId: userId,
        });
        if (!userApiKey) {
            console.log('User not found, skipping...');
            return false;
        }
        if (userApiKey.apiKeyGroqValid === false) {
            console.log('User does not have a Groq API key, skipping...');
            return false;
        }

        if (!force) {
            // Check if task was already completed today
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const existingTask = await ModelLlmPendingTaskCron.findOne({
                taskType: llmPendingTaskTypes.page.settings.groqModelGet,
                taskStatus: {
                    $ne: 'pending'
                },
                createdAtUtc: {
                    $gte: today
                }
            });

            if (existingTask) {
                console.log('Groq model fetch already completed today, skipping...');
                return true;
            }
        }

        const response = await axios.get('https://api.groq.com/openai/v1/models', {
            headers: {
                'Authorization': `Bearer ${userApiKey.apiKeyGroq}`,
                'Content-Type': 'application/json',
            },
        });

        const data = response.data.data;

        if (data.length >= 1) {
            let filterDoc = data.map((element: any) => {
                const modelId = (element.id || '').toLowerCase();
                const isWhisper = modelId.includes('whisper');
                const isVision = modelId.includes('vision');
                const isTts = modelId.includes('tts') || modelId.includes('speech');

                const isInputText = isWhisper ? 'false' : 'true';
                const isInputImage = isVision ? 'true' : 'false';
                const isInputAudio = isWhisper ? 'true' : 'false';
                const isInputVideo = 'false';

                const isOutputText = isTts ? 'false' : 'true';
                const isOutputImage = 'false';
                const isOutputAudio = isTts ? 'true' : 'false';
                const isOutputVideo = 'false';
                const isOutputEmbedding = modelId.includes('embed') ? 'true' : 'false';

                const contextLen = Number(element.context_window) || 0;
                let maxCompletionTokens = Number(element.max_completion_tokens || element.max_tokens || element.max_output_tokens) || 0;

                if (maxCompletionTokens === 0) {
                    if (modelId.includes('llama-3.3-70b') || modelId.includes('llama-3.1-70b') || modelId.includes('mixtral-8x7b')) {
                        maxCompletionTokens = 32768;
                    } else if (modelId.includes('llama-3.1') || modelId.includes('llama-3.2') || modelId.includes('gemma') || modelId.includes('deepseek') || modelId.includes('qwen')) {
                        maxCompletionTokens = 8192;
                    } else if (contextLen > 0) {
                        maxCompletionTokens = Math.min(contextLen, 8192);
                    }
                }

                return {
                    ...element,
                    contextLength: contextLen,
                    context_window: contextLen,
                    maxCompletionTokens: maxCompletionTokens,
                    isInputModalityText: isInputText,
                    isInputModalityImage: isInputImage,
                    isInputModalityAudio: isInputAudio,
                    isInputModalityVideo: isInputVideo,
                    isOutputModalityText: isOutputText,
                    isOutputModalityImage: isOutputImage,
                    isOutputModalityAudio: isOutputAudio,
                    isOutputModalityVideo: isOutputVideo,
                    isOutputModalityEmbedding: isOutputEmbedding,
                    raw: element,
                };
            });

            // delete all and insert new
            await ModelAiListGroq.deleteMany({});
            await ModelAiListGroq.insertMany(filterDoc);

            // insert into ai model modality
            for (let index = 0; index < filterDoc.length; index++) {
                const element = filterDoc[index];

                // upsert into aiModelModality
                await ModelAiModelModality.findOneAndUpdate(
                    {
                        provider: 'groq',
                        modalIdString: element.id,
                    },
                    {
                        $set: {
                            provider: 'groq',
                            modalIdString: element.id,
                            contextLength: element.contextLength,
                            maxCompletionTokens: element.maxCompletionTokens,
                            isInputModalityText: element.isInputModalityText,
                            isInputModalityImage: element.isInputModalityImage,
                            isInputModalityAudio: element.isInputModalityAudio,
                            isInputModalityVideo: element.isInputModalityVideo,
                            isOutputModalityText: element.isOutputModalityText,
                            isOutputModalityImage: element.isOutputModalityImage,
                            isOutputModalityAudio: element.isOutputModalityAudio,
                            isOutputModalityVideo: element.isOutputModalityVideo,
                            isOutputModalityEmbedding: element.isOutputModalityEmbedding,
                        }
                    },
                    { upsert: true }
                );
            }
        }

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default groqModelGet;