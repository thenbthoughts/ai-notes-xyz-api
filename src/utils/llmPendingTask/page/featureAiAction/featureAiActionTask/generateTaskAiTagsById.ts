import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    isAxiosError,
} from "axios";
import { NodeHtmlMarkdown } from 'node-html-markdown';

import openrouterMarketing from "../../../../../config/openrouterMarketing";
import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelTask } from "../../../../../schema/schemaTask/SchemaTask.schema";
import { tsTaskList } from "../../../../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types";

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

        let systemPrompt = `You are a JSON-based AI assistant specialized in extracting key topics and terms from user notes.
        Your task is to identify and generate a list of significant keywords based on the content provided by the user.
        These keywords should represent the main ideas, themes, or topics covered in the user's input.

        Output the result in JSON format as follows:
        {
            "keywords\": [\"keyword 1\", \"keyword 2\", \"keyword 3\", ...]
        }
        
        Avoid generic words (e.g., 'the,' 'is,' 'and') and words with no specific relevance.
        Ensure that the keywords are concise and meaningful for quick reference.

        Respond only with the JSON structure.`;

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

        const finalTagsOutput = [] as string[];

        if (Array.isArray(keywordsResponse?.keywords)) {
            const keywords = keywordsResponse?.keywords;
            for (let index = 0; index < keywords.length; index++) {
                const element = keywords[index];
                if (typeof element === 'string') {
                    finalTagsOutput.push(element.trim());
                }
            }
        }

        return finalTagsOutput; // Return only the array of strings
    } catch (error: any) {
        console.error(error);
        if (isAxiosError(error)) {
            console.error(error.message);
        }
        console.error(error.response)
        return [];
    }
}

const  generateTaskAiTagsById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        const taskRecords = await ModelTask.find({
            _id: targetRecordId,
        }) as tsTaskList[];

        if (!taskRecords || taskRecords.length !== 1) {
            return true;
        }

        const taskFirst = taskRecords[0];

        const apiKeys = await ModelUserApiKey.findOne({
            username: taskFirst.username,
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
            labelsAi?: string[];
        };

        let argContent = `Title: ${taskFirst.title}`;
        
        if(taskFirst.description && taskFirst.description.length >= 1) {
            const markdownContent = NodeHtmlMarkdown.translate(taskFirst.description);
            argContent += `Description: ${markdownContent}\n`;
        }
        if(taskFirst.priority) {
            argContent += `Priority: ${taskFirst.priority}\n`;
        }
        if(taskFirst.dueDate) {
            argContent += `Due Date: ${taskFirst.dueDate}\n`;
        }
        if(taskFirst.labels.length >= 1) {
            argContent += `Labels: ${taskFirst.labels.join(', ')}\n`;
        }
        if(taskFirst.isCompleted) {
            argContent += `Status: Completed\n`;
        } else {
            argContent += `Status: Pending\n`;
        }

        // Use fetchLlmTags to generate tags from the content
        const generatedTags = await fetchLlmTags({
            argContent: argContent,
            llmAuthToken,
            modelProvider: modelProvider as 'groq' | 'openrouter',
        });
        if (generatedTags.length >= 1) {
            updateObj.labelsAi = generatedTags;
            updateObj.labelsAi = updateObj.labelsAi.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        }

        if (Object.keys(updateObj).length >= 1) {
            await ModelTask.updateOne(
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

export default generateTaskAiTagsById;

