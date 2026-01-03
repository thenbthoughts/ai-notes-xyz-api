import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    isAxiosError,
} from "axios";
import openrouterMarketing from "../../../../../config/openrouterMarketing";
import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelLifeEvents } from "../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ILifeEvents } from "../../../../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types";
import lifeCategoriesAiJson from "../../../../../routes/lifeEvents/lifeEventsCrud/LifeCategoriesAiJson";

interface tsMessage {
    role: string;
    content: string;
}

interface tsRequestData {
    messages: tsMessage[];
    model: string;
    temperature: number;
    max_tokens: number;
    top_p: number;
    stream: boolean;
    stop: null | string;
    response_format?: {
        type: "json_object"
    }
}

const fetchLlmTags = async ({
    argContent,

    llmAuthToken,
    modelProvider,
}: {
    argContent: string,

    llmAuthToken: string;
    modelProvider: 'groq' | 'openrouter';
}) => {
    try {
        // Validate input
        if (typeof argContent !== 'string' || argContent.trim() === '') {
            throw new Error('Invalid input: argContent must be a non-empty string.');
        }

        let apiEndpoint = '';
        let modelName = '';
        if (modelProvider === 'openrouter') {
            apiEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
            modelName = 'openai/gpt-oss-20b';
        } else if (modelProvider === 'groq') {
            apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
            modelName = 'openai/gpt-oss-20b';
        }

        let lifeCategoriesAiJsonString = '';
        for (let index = 0; index < lifeCategoriesAiJson.length; index++) {
            const element = lifeCategoriesAiJson[index];
            lifeCategoriesAiJsonString += `${index + 1}. Category: ${element.name}\n`;
            for (let index2 = 0; index2 < element.subcategory.length; index2++) {
                const element2 = element.subcategory[index2];
                lifeCategoriesAiJsonString += `${index + 1}. ${index2 + 1}. Subcategory: ${element2}\n`;
            }
        }

        let systemPrompt = `
        You are a JSON-based AI assistant trained to classify life events into structured categories.
        Your task is to analyze the user's life event description and suggest the most appropriate "category" and "subcategory" based strictly on the provided list.

        The list of categories and their subcategories is as follows:
        ${lifeCategoriesAiJsonString}

        Your response must:
        - Select only one most relevant category and subcategory.
        - Ensure the values are exact matches from the list (no new values or variants).
        - Avoid generic or vague matches if a more specific one exists.
        - Default to category "Other" and subcategory "Other" if no good match is found.

        Respond only with the following JSON format (no extra text):
        {
            "category": "",
            "subcategory": ""
        }
        `;

        const data: tsRequestData = {
            messages: [
                {
                    role: "system",
                    content: systemPrompt,
                },
                {
                    role: "user",
                    content: argContent,
                }
            ],
            model: modelName,
            temperature: 0,
            max_tokens: 1024,
            top_p: 1,
            stream: false,
            response_format: {
                type: "json_object"
            },
            stop: null
        };

        const config: AxiosRequestConfig = {
            method: 'post',
            url: apiEndpoint,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${llmAuthToken}`,
                ...openrouterMarketing,
            },
            data: JSON.stringify(data)
        };

        const response: AxiosResponse = await axios.request(config);
        const keywordsResponse = JSON.parse(response.data.choices[0].message.content);

        const returnObj = {
            category: '',
            subcategory: '',
        } as {
            category: string;
            subcategory: string;
        };

        if (typeof keywordsResponse?.category === 'string') {
            returnObj.category = keywordsResponse.category;
        }
        if (typeof keywordsResponse?.subcategory === 'string') {
            returnObj.subcategory = keywordsResponse.subcategory;
        }

        return returnObj;
    } catch (error: any) {
        console.error(error);
        if (isAxiosError(error)) {
            console.error(error.message);
        }
        console.error(error.response)
        return {
            category: 'Other',
            subcategory: 'Other',
        } as {
            category: string;
            subcategory: string;
        };
    }
}

const generateLifeEventAiCategoryById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        const lifeEventRecords = await ModelLifeEvents.find({
            _id: targetRecordId,
        }) as ILifeEvents[];

        if (!lifeEventRecords || lifeEventRecords.length !== 1) {
            return true;
        }

        const lifeEventFirst = lifeEventRecords[0];

        const apiKeys = await ModelUserApiKey.findOne({
            username: lifeEventFirst.username,
            $or: [
                {
                    apiKeyGroqValid: true,
                },
                {
                    apiKeyOpenrouterValid: true,
                },
            ]
        });
        if (!apiKeys) {
            return true;
        }

        let modelProvider = '' as "groq" | "openrouter";
        let llmAuthToken = '';
        if (apiKeys.apiKeyOpenrouterValid) {
            modelProvider = 'openrouter';
            llmAuthToken = apiKeys.apiKeyOpenrouter;
        } else if (apiKeys.apiKeyGroqValid) {
            modelProvider = 'groq';
            llmAuthToken = apiKeys.apiKeyGroq;
        }

        const updateObj = {
            aiCategory: 'Other',
            aiSubCategory: 'Other',
        } as {
            aiCategory: string;
            aiSubCategory: string;
        };

        let argContent = `Title: ${lifeEventFirst.title}`;
        argContent += `Description: ${lifeEventFirst.description}\n`;
        argContent += `Event Impact: ${lifeEventFirst.eventImpact}\n`;
        if (lifeEventFirst.isStar) {
            argContent += `Is Star: Starred life event\n`;
        }
        if (lifeEventFirst.tags.length >= 1) {
            argContent += `Tags: ${lifeEventFirst.tags.join(', ')}\n`;
        }
        argContent += `Event Date: ${lifeEventFirst.eventDateUtc}\n`;
        argContent += `Event Date Year: ${lifeEventFirst.eventDateYearStr}\n`;
        argContent += `Event Date Year Month: ${lifeEventFirst.eventDateYearMonthStr}\n`;

        // Use fetchLlmGroqTags to generate tags from the content of the first message
        const generatedCategory = await fetchLlmTags({
            argContent: argContent,
            llmAuthToken,
            modelProvider: modelProvider as 'groq' | 'openrouter',
        });
        updateObj.aiCategory = generatedCategory.category;
        updateObj.aiSubCategory = generatedCategory.subcategory;

        if (Object.keys(updateObj).length >= 1) {
            await ModelLifeEvents.updateOne(
                { _id: targetRecordId },
                {
                    $set: {
                        ...updateObj,
                    },
                }
            );
        }

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default generateLifeEventAiCategoryById;

