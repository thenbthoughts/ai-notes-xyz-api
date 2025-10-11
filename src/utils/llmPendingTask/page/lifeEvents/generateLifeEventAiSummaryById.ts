import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    isAxiosError,
} from "axios";
import openrouterMarketing from "../../../../config/openrouterMarketing";
import { ModelUserApiKey } from "../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelLifeEvents } from "../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ILifeEvents } from "../../../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types";

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

        let systemPrompt = `From the below content, generate a detailed summary in simple language.
        Only output the summary, no other text. No markdown.
        Also give few suggestions for the life event.
        Also suggest out of the box ideas.`;

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
        const summaryResponse = response.data.choices[0].message.content;

        return summaryResponse; // Return only the array of strings
    } catch (error: any) {
        console.error(error);
        if (isAxiosError(error)) {
            console.error(error.message);
        }
        console.error(error.response)
        return '';
    }
}

const  generateLifeEventAiSummaryById = async ({
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
        } as {
            aiSummary?: string;
        };

        let argContent = `Title: ${lifeEventFirst.title}`;
        argContent += `Description: ${lifeEventFirst.description}\n`;
        argContent += `Event Impact: ${lifeEventFirst.eventImpact}\n`;
        if(lifeEventFirst.isStar) {
            argContent += `Is Star: Starred life event\n`;
        }
        if(lifeEventFirst.tags.length >= 1) {
            argContent += `Tags: ${lifeEventFirst.tags.join(', ')}\n`;
        }
        argContent += `Event Date: ${lifeEventFirst.eventDateUtc}\n`;
        argContent += `Event Date Year: ${lifeEventFirst.eventDateYearStr}\n`;
        argContent += `Event Date Year Month: ${lifeEventFirst.eventDateYearMonthStr}\n`;

        // Use fetchLlmGroqTags to generate tags from the content of the first message
        const generatedSummary = await fetchLlmTags({
            argContent: argContent,
            llmAuthToken,
            modelProvider: modelProvider as 'groq' | 'openrouter',
        });
        if (generatedSummary.length >= 1) {
            updateObj.aiSummary = generatedSummary;
        }

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

export default generateLifeEventAiSummaryById;