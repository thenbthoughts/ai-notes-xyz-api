import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    isAxiosError,
} from "axios";
import { NodeHtmlMarkdown } from 'node-html-markdown';
import openrouterMarketing from "../../../../../config/openrouterMarketing";
import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelNotes } from "../../../../../schema/schemaNotes/SchemaNotes.schema";
import { INotes } from "../../../../../types/typesSchema/typesSchemaNotes/SchemaNotes.types";

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

        let systemPrompt = `From the below content, generate a very detailed summary in simple language.
        Only output the summary, no other text. No markdown.
        Suggest out of the box ideas.
        Suggest few actions that can be taken.
        Suggestions for life.
        Suggest few thoughtful questions that can be asked to the user to gather more information, uncover hidden needs, or improve the contents relevance and impact.`;

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

const  generateNotesAiSummaryById = async ({
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
            aiSummary?: string;
        };

        let argContent = `Title: ${notesFirst.title}`;
        if(notesFirst.description.length >= 1) {
            const markdownContent = NodeHtmlMarkdown.translate(notesFirst.description);
            argContent += `Description: ${markdownContent}\n`;
        }
        if(notesFirst.isStar) {
            argContent += `Is Star: Starred life event\n`;
        }
        if(notesFirst.tags.length >= 1) {
            argContent += `Tags: ${notesFirst.tags.join(', ')}\n`;
        }

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

export default generateNotesAiSummaryById;