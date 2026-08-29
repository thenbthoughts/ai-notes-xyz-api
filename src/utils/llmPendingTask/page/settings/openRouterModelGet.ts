import axios from "axios";

import openrouterMarketing from "../../../../config/openrouterMarketing";
import { ModelAiListOpenrouter } from "../../../../schema/schemaDynamicData/SchemaOpenrouterModel.schema";
import { ModelLlmPendingTaskCron } from "../../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema";
import { llmPendingTaskTypes } from "../../llmPendingTaskConstants";
import { ModelAiModelModality } from "../../../../schema/schemaDynamicData/SchemaAiModelModality.schema";

const openRouterModelGet = async (options?: { force?: boolean }) => {
    try {
        if (!options?.force) {
            // Check if task was already completed today
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const existingTask = await ModelLlmPendingTaskCron.findOne({
                taskType: llmPendingTaskTypes.page.settings.openRouterModelGet,
                taskStatus: {
                    $ne: 'pending'
                },
                createdAtUtc: {
                    $gte: today
                }
            });

            if (existingTask) {
                console.log('OpenRouter model fetch already completed today, skipping...');
                return true;
            }
        }

        const response = await axios.get('https://openrouter.ai/api/v1/models', {
            headers: {
                'Content-Type': 'application/json',
                ...openrouterMarketing,
            },
        });

        const data = response.data.data;

        if (data.length >= 1) {
            let filterDoc = data.filter((item: any) => {
                let isValid = true;

                // exclude free models as the output may be stored in the database
                if (
                    item.id.toLowerCase().includes('free') ||
                    item.name.toLowerCase().includes('free')
                ) {
                    isValid = false;
                }

                return isValid;
            });

            const processedDocs = filterDoc.map((item: any) => {
                const inputModalities = item.architecture?.input_modalities || [];
                const outputModalities = item.architecture?.output_modalities || [];
                const modalityStr = item.architecture?.modality || '';

                const isInputText = inputModalities.includes('text') ? 'true' : 'false';
                const isInputImage = inputModalities.includes('image') ? 'true' : 'false';
                const isInputAudio = inputModalities.includes('audio') ? 'true' : 'false';
                const isInputVideo = inputModalities.includes('video') ? 'true' : 'false';

                const isOutputText = (outputModalities.includes('text') || modalityStr.includes('->text') || (!outputModalities.length && isInputText === 'true')) ? 'true' : 'false';
                const isOutputImage = (outputModalities.includes('image') || modalityStr.includes('->image')) ? 'true' : 'false';
                const isOutputAudio = (outputModalities.includes('audio') || modalityStr.includes('->audio')) ? 'true' : 'false';
                const isOutputVideo = (outputModalities.includes('video') || modalityStr.includes('->video')) ? 'true' : 'false';
                const isOutputEmbedding = (outputModalities.includes('embedding') || modalityStr.includes('embeddings')) ? 'true' : 'false';

                const maxCompletionTokens = Number(item.top_provider?.max_completion_tokens || item.max_completion_tokens || item.architecture?.max_completion_tokens) || 0;

                return {
                    id: item.id,
                    name: item.name || item.id,
                    description: item.description || '',
                    contextLength: Number(item.context_length) || 0,
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
                    raw: item,
                };
            });

            // delete all and insert new
            await ModelAiListOpenrouter.deleteMany({});
            await ModelAiListOpenrouter.insertMany(processedDocs);

            // insert into aiModelModality
            let filterDocModality = processedDocs.map((item: any) => {
                return {
                    provider: 'openrouter',
                    modalIdString: item.id,
                    contextLength: item.contextLength,
                    maxCompletionTokens: item.maxCompletionTokens,
                    isInputModalityText: item.isInputModalityText,
                    isInputModalityImage: item.isInputModalityImage,
                    isInputModalityAudio: item.isInputModalityAudio,
                    isInputModalityVideo: item.isInputModalityVideo,
                    isOutputModalityText: item.isOutputModalityText,
                    isOutputModalityImage: item.isOutputModalityImage,
                    isOutputModalityAudio: item.isOutputModalityAudio,
                    isOutputModalityVideo: item.isOutputModalityVideo,
                    isOutputModalityEmbedding: item.isOutputModalityEmbedding,
                };
            });

            await ModelAiModelModality.deleteMany({
                provider: 'openrouter',
            });
            await ModelAiModelModality.insertMany(filterDocModality);
        }

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default openRouterModelGet;