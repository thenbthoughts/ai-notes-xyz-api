import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    isAxiosError,
} from "axios";
import { NodeHtmlMarkdown } from 'node-html-markdown';

import openrouterMarketing from "../../../../config/openrouterMarketing";
import { ModelUserApiKey } from "../../../../schema/SchemaUserApiKey.schema";
import { ModelNotes } from "../../../../schema/schemaNotes/SchemaNotes.schema";
import { INotes } from "../../../../types/typesSchema/typesSchemaNotes/SchemaNotes.types";

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

const  generateNotesAiTagsById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        const notesRecords = await ModelNotes.find({
            _id: targetRecordId,
        }) as INotes[];

        if (!notesRecords || notesRecords.length !== 1) {
            return true;
        }

        const notesFirst = notesRecords[0];

        const apiKeys = await ModelUserApiKey.findOne({
            username: notesFirst.username,
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
            aiTags?: string[];
        };

        let argContent = `Title: ${notesFirst.title}`;
        
        if(notesFirst.description.length >= 1) {
            const markdownContent = NodeHtmlMarkdown.translate(notesFirst.description);
            argContent += `Description: ${markdownContent}\n`;
        }
        if(notesFirst.isStar) {
            argContent += `Is Star: Starred note\n`;
        }
        if(notesFirst.tags.length >= 1) {
            argContent += `Tags: ${notesFirst.tags.join(', ')}\n`;
        }

        // Use fetchLlmGroqTags to generate tags from the content of the first message
        const generatedTags = await fetchLlmTags({
            argContent: argContent,
            llmAuthToken,
            modelProvider: modelProvider as 'groq' | 'openrouter',
        });
        if (generatedTags.length >= 1) {
            updateObj.aiTags = generatedTags;
            updateObj.aiTags = updateObj.aiTags.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        }

        if (Object.keys(updateObj).length >= 1) {
            await ModelNotes.updateOne(
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

export default generateNotesAiTagsById;