import axios from "axios";

import { ModelAiListGroq } from "../../../../schema/schemaDynamicData/SchemaGroqModel.schema";
import { ModelLlmPendingTaskCron } from "../../../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema";
import { llmPendingTaskTypes } from "../../llmPendingTaskConstants";
import { ModelUserApiKey } from "../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelAiModelModality } from "../../../../schema/schemaDynamicData/SchemaAiModelModality.schema";

const groqModelGet = async ({
    username,
}: {
    username: string;
}) => {
    try {
        // check if user is valid
        const userApiKey = await ModelUserApiKey.findOne({
            username: username,
        });
        if (!userApiKey) {
            console.log('User not found, skipping...');
            return false;
        }
        if (userApiKey.apiKeyGroqValid === false) {
            console.log('User does not have a Groq API key, skipping...');
            return false;
        }

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

        const response = await axios.get('https://api.groq.com/openai/v1/models', {
            headers: {
                'Authorization': `Bearer ${userApiKey.apiKeyGroq}`,
                'Content-Type': 'application/json',
            },
        });

        const data = response.data.data;

        if (data.length >= 1) {
            let filterDoc = data;

            // delete all and insert new
            await ModelAiListGroq.deleteMany({});
            await ModelAiListGroq.insertMany(filterDoc);

            // insert into ai model modality
            for (let index = 0; index < filterDoc.length; index++) {
                const element = filterDoc[index];

                // find if exists
                const resultModelModality = await ModelAiModelModality.findOne({
                    provider: 'groq',
                    modalIdString: element.id,
                });
                if (!resultModelModality) {
                    // insert
                    await ModelAiModelModality.create({
                        provider: 'groq',
                        modalIdString: element.id,
                        isInputModalityText: 'pending',
                        isInputModalityImage: 'pending',
                        isInputModalityAudio: 'pending',
                        isInputModalityVideo: 'pending',
                    });
                }
            }
        }

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default groqModelGet;