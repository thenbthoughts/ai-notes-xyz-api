import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    isAxiosError,
} from "axios";
import openrouterMarketing from "../../../../config/openrouterMarketing";
import { ModelChatLlm } from "../../../../schema/SchemaChatLlm.schema";
import { ModelUserApiKey } from "../../../../schema/SchemaUserApiKey.schema";
import { IChatLlm } from "../../../../types/typesSchema/SchemaChatLlm.types";

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
            modelName = 'meta-llama/llama-3.2-11b-vision-instruct';
        } else if (modelProvider === 'groq') {
            apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
            modelName = 'meta-llama/llama-4-scout-17b-16e-instruct';
        }

        const data: tsRequestData = {
            messages: [
                {
                    role: "system",
                    content: "You are a JSON-based AI assistant specialized in extracting key topics and terms from user notes. Your task is to identify and generate a list of significant keywords based on the content provided by the user. These keywords should represent the main ideas, themes, or topics covered in the user's input. Output the result in JSON format as follows:\n\n{\n  \"keywords\": [\"keyword 1\", \"keyword 2\", \"keyword 3\", ...]\n}\n\nFocus on capturing nouns, significant verbs, and unique terms relevant to the content.\nAvoid generic words (e.g., 'the,' 'is,' 'and') and words with no specific relevance.\nEnsure that the keywords are concise and meaningful for quick reference.\n\nRespond only with the JSON structure.",
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

const  generateChatTagsById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        const messages = await ModelChatLlm.find({
            _id: targetRecordId,
        }) as IChatLlm[];

        if (!messages || messages.length !== 1) {
            return true;
        }

        const messageFirst = messages[0];

        const apiKeys = await ModelUserApiKey.findOne({
            username: messageFirst.username,
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
            tags?: string[];
        };

        // Use fetchLlmGroqTags to generate tags from the content of the first message
        const generatedTags = await fetchLlmTags({
            argContent: messages[0].content,
            llmAuthToken,
            modelProvider: modelProvider as 'groq' | 'openrouter',
        });
        if (generatedTags.length >= 1) {
            updateObj.tags = generatedTags;
        }

        if (Object.keys(updateObj).length >= 1) {
            await ModelChatLlm.updateOne(
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

export default generateChatTagsById;