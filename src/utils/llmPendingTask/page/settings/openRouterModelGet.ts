import axios from "axios";

import openrouterMarketing from "../../../../config/openrouterMarketing";
import { ModelAiListOpenrouter } from "../../../../schema/schemaDynamicData/SchemaOpenrouterModel.schema";
import { ModelLlmPendingTaskCron } from "../../../../schema/SchemaLlmPendingTaskCron.schema";
import { llmPendingTaskTypes } from "../../llmPendingTaskConstants";


const  openRouterModelGet = async () => {
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

        if(data.length >= 1) {
            // delete all and insert new
            await ModelAiListOpenrouter.deleteMany({});
            await ModelAiListOpenrouter.insertMany(data);
        }

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default openRouterModelGet;