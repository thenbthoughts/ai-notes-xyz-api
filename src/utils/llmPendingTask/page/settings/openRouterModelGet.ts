import axios from "axios";

import openrouterMarketing from "../../../../config/openrouterMarketing";
import { ModelAiListOpenrouter } from "../../../../schema/schemaDynamicData/SchemaOpenrouterModel.schema";
import { ModelLlmPendingTaskCron } from "../../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema";
import { llmPendingTaskTypes } from "../../llmPendingTaskConstants";
import { ModelAiModelModality } from "../../../../schema/schemaDynamicData/SchemaAiModelModality.schema";

const openRouterModelGet = async () => {
    try {
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

            // delete all and insert new
            await ModelAiListOpenrouter.deleteMany({});
            await ModelAiListOpenrouter.insertMany(filterDoc);

            // insert into aiModelModality
            let filterDocModality = filterDoc.map((item: any) => {
                let modalIdString = item.id;
                let isText = item.architecture.input_modalities.includes('text') ? 'true' : 'false';
                let isImage = item.architecture.input_modalities.includes('image') ? 'true' : 'false';
                let isAudio = item.architecture.input_modalities.includes('audio') ? 'true' : 'false';
                let isVideo = item.architecture.input_modalities.includes('video') ? 'true' : 'false';

                return {
                    provider: 'openrouter',
                    modalIdString: modalIdString,
                    isInputModalityText: isText,
                    isInputModalityImage: isImage,
                    isInputModalityAudio: isAudio,
                    isInputModalityVideo: isVideo,
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