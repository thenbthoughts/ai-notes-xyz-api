import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    isAxiosError,
} from "axios";
import openrouterMarketing from "../../../../config/openrouterMarketing";
import { ModelChatLlmThread } from "../../../../schema/SchemaChatLlmThread.schema";
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

const fetchLlmSummarise = async ({
    argContentArr,

    llmAuthToken,
    modelProvider,
}: {
    argContentArr: IChatLlm[],

    llmAuthToken: string;
    modelProvider: 'groq' | 'openrouter';
}) => {
    try {
        // Validate input
        if (!Array.isArray(argContentArr) || argContentArr.length === 0) {
            throw new Error('Invalid input: argContentArr must be a non-empty array.');
        }

        const messages = [] as tsMessage[];

        let systemPrompt = '';
        systemPrompt += `You are an AI thread summarizer specialized in summarizing multi-message discussion threads. `;
        systemPrompt += `Given a series of messages labeled as either user or assistant contributions, generate a concise and clear summary that captures the main points, key ideas, and important information shared across the entire thread. `;
        systemPrompt += `The summary should be brief, easy to understand, and free of added opinions or new information. `;
        systemPrompt += `Respond only with the summary text.`;

        messages.push({
            role: "system",
            content: systemPrompt,
        });

        for (let index = 0; index < argContentArr.length; index++) {
            const element = argContentArr[index];

            if (element.content.includes("AI:")) {
                messages.push({
                    role: "assistant",
                    content: `AI -> Conversation ${index + 1}: ${element.content.replace("AI:", "").trim()}`,
                });
            } else {
                messages.push({
                    role: "user",
                    content: `User -> Conversation ${index + 1}: ${element.content.replace('Text to audio:', '')}`,
                });
            }
        }

        messages.push({
            role: "user",
            content: "Summarize",
        });

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
            messages: messages,
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
        const strResponse = response?.data?.choices[0]?.message?.content;

        if (typeof strResponse === 'string') {
            if (strResponse.length >= 1) {
                return strResponse;
            }
        }

        return '';
    } catch (error: any) {
        console.error(error);
        if (isAxiosError(error)) {
            console.error(error.message);
        }
        console.error(error.response)
        return '';
    }
}

const fetchLlmTitle = async ({
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

        let systemPrompt = '';
        systemPrompt += `You are an AI assistant specialized in creating concise and descriptive titles based on user notes. `;
        systemPrompt += `Your task is to generate a clear and meaningful title that captures the main idea or theme of the content provided by the user. `;
        systemPrompt += `The title should be brief, relevant, and informative. Respond only with the title text, without any additional formatting or explanation. `;

        const data: tsRequestData = {
            messages: [
                {
                    role: "system",
                    content: systemPrompt,
                },
                {
                    role: "user",
                    content: argContent,
                },
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
        const strResponse = response?.data?.choices[0]?.message?.content;

        if (typeof strResponse === 'string') {
            if (strResponse.length >= 1) {
                return strResponse;
            }
        }

        return '';
    } catch (error: any) {
        console.error(error);
        if (isAxiosError(error)) {
            console.error(error.message);
        }
        console.error(error.response)
        return '';
    }
}

const  generateChatThreadTitleById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        const messages = await ModelChatLlm.find({
            threadId: targetRecordId,
        }) as IChatLlm[];

        if (!messages || messages.length === 0) {
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
            threadTitle?: string;
            tagsAi?: string[];
            aiSummary?: string;
        };

        const resultSummary = await fetchLlmSummarise({
            argContentArr: messages,
            llmAuthToken,
            modelProvider,
        })
        if (resultSummary.length >= 1) {
            updateObj.aiSummary = resultSummary;

            // Use fetchLlmGroqTags to generate tags from the content of the first message
            const generatedTags = await fetchLlmTags({
                argContent: resultSummary,
                llmAuthToken,
                modelProvider: modelProvider as 'groq' | 'openrouter',
            });
            if (generatedTags.length >= 1) {
                updateObj.tagsAi = generatedTags;
            }

            const generatedTitle = await fetchLlmTitle({
                argContent: resultSummary,
                llmAuthToken,
                modelProvider: modelProvider as 'groq' | 'openrouter',
            });
            if (generatedTitle.length >= 1) {
                updateObj.threadTitle = generatedTitle;
            }
        }

        if (Object.keys(updateObj).length >= 1) {
            await ModelChatLlmThread.updateOne(
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

export default generateChatThreadTitleById;