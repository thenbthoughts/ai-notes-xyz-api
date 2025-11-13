import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    isAxiosError,
} from "axios";
import mongoose from "mongoose";
import openrouterMarketing from "../../../../config/openrouterMarketing";

import { ModelUserApiKey } from "../../../../schema/schemaUser/SchemaUserApiKey.schema";

import { ModelLlmContextKeyword } from "../../../../schema/schemaLlmContext/SchemaLlmContextKeyword.schema";

import { ModelNotes } from "../../../../schema/schemaNotes/SchemaNotes.schema";
import { ModelTask } from "../../../../schema/schemaTask/SchemaTask.schema";
import { ModelChatLlm } from "../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelLifeEvents } from "../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ModelInfoVault } from "../../../../schema/schemaInfoVault/SchemaInfoVault.schema";
import { ModelUser } from "../../../../schema/schemaUser/SchemaUser.schema";

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

interface tsKeywordsResponse {
    oneWordKeywords?: string[];
    longKeywords?: string[];
    shortKeywords?: string[];
    seoFriendlyKeywords?: string[];
    oneLayerUpKeywords?: string[];
    categoryKeywords?: string[];
    subCategoryKeywords?: string[];
    aiCategory?: string;
    aiSubCategory?: string;
    aiTopic?: string;
    aiSubTopic?: string;
}

const fetchLlmKeywords = async ({
    argContent,
    llmAuthToken,
    modelProvider,
    languagesStr,
}: {
    argContent: string,
    llmAuthToken: string;
    modelProvider: 'groq' | 'openrouter';
    languagesStr: string;
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

        let systemPromptLanguages = '';
        if (languagesStr && languagesStr.length > 0) {
            systemPromptLanguages = `The user's spoken languages are: ${languagesStr}. `;
            systemPromptLanguages += `Generate keywords in english and the user's spoken languages. `;
        }

        const systemPrompt = `You are a JSON-based AI assistant specialized in generating comprehensive keywords from content.

Your task is to analyze the provided content and generate various types of keywords:

1. **One Word Keywords**: Single, powerful words that capture the essence
2. **Long Keywords**: Descriptive phrases with 4-6 words
3. **Short Keywords**: 2-3 word phrases
4. **SEO Friendly Keywords**: Search-optimized phrases that people would actually search for
5. **One Layer Up Keywords**: Broader, more general categories
6. **Category Keywords**: Main category classifications
7. **Sub Category Keywords**: More specific sub-classifications
8. **AI Category**: Single high-level category (e.g., "Technology", "Business", "Personal Development") - provide only ONE category as a STRING
9. **AI Sub Category**: Single more specific categorization (e.g., "Software Development", "Marketing", "Fitness") - provide only ONE sub-category as a STRING
10. **AI Topic**: Single specific topic covered (e.g., "React Hooks", "Email Marketing", "Weight Training") - provide only ONE topic as a STRING
11. **AI Sub Topic**: Single detailed sub-topic (e.g., "useState Hook", "Email Automation", "Compound Exercises") - provide only ONE sub-topic as a STRING

Output the result in JSON format as follows:
{
    "oneWordKeywords": ["keyword1", "keyword2", ...],
    "longKeywords": ["long keyword phrase 1", "long keyword phrase 2", ...],
    "shortKeywords": ["short phrase 1", "short phrase 2", ...],
    "seoFriendlyKeywords": ["seo keyword 1", "seo keyword 2", ...],
    "oneLayerUpKeywords": ["broader term 1", "broader term 2", ...],
    "categoryKeywords": ["category 1", "category 2", ...],
    "subCategoryKeywords": ["subcategory 1", "subcategory 2", ...],
    "aiCategory": "single category string",
    "aiSubCategory": "single subcategory string",
    "aiTopic": "single topic string",
    "aiSubTopic": "single subtopic string"
}

Generate at least 10-50 keywords for each array type.
For aiCategory, aiSubCategory, aiTopic, and aiSubTopic, provide exactly ONE string value (not an array).
Focus on relevance, diversity, and searchability.
Avoid generic words with no specific relevance.
Ensure keywords are meaningful and capture different aspects of the content.
${systemPromptLanguages}

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
            temperature: 0.7,
            max_tokens: 8096,
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
        const keywordsResponse: tsKeywordsResponse = JSON.parse(response.data.choices[0].message.content);

        return keywordsResponse;
    } catch (error: any) {
        console.error(error);
        if (isAxiosError(error)) {
            console.error(error.message);
        }
        console.error(error.response);
        return null;
    }
}

const generateKeywordsBySourceId = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    console.log('generateKeywordsBySourceId: ', targetRecordId);
    try {
        if (!targetRecordId) {
            return true;
        }

        const targetRecordIdObj = mongoose.Types.ObjectId.createFromHexString(targetRecordId.toString());
        if (!targetRecordIdObj) {
            return true;
        }

        // Try to find the record in each model
        let sourceType = '';
        let username = '';
        let content = '';

        // Try Notes
        let isExecuted = false;

        // Execute Notes
        if (!isExecuted) {
            const note = await ModelNotes.findOne({ _id: targetRecordIdObj });
            if (note) {
                sourceType = 'notes';
                username = note.username;
                content = `Title: ${note.title}\n`;
                content += `Description: ${note.description}\n`;
                if (note.tags && note.tags.length > 0) {
                    content += `Tags: ${note.tags.join(', ')}\n`;
                }
                if (note.aiSummary) {
                    content += `AI Summary: ${note.aiSummary}\n`;
                }
                isExecuted = true;
            }
        }

        // Execute Task
        if (!isExecuted) {
            const task = await ModelTask.findOne({ _id: targetRecordIdObj });
            if (task) {
                sourceType = 'tasks';
                username = task.username;
                content = `Title: ${task.title}\n`;
                content += `Description: ${task.description}\n`;
                if (task.labels && task.labels.length > 0) {
                    content += `Labels: ${task.labels.join(', ')}\n`;
                }
                if (task.priority) {
                    content += `Priority: ${task.priority}\n`;
                }
                isExecuted = true;
            }
        }

        // Execute ChatLlm
        if (!isExecuted) {
            const chatLlm = await ModelChatLlm.findOne({ _id: targetRecordIdObj });
            if (chatLlm) {
                sourceType = 'chatLlm';
                username = chatLlm.username;
                content = `Content: ${chatLlm.content}\n`;
                if (chatLlm.tags && chatLlm.tags.length > 0) {
                    content += `Tags: ${chatLlm.tags.join(', ')}\n`;
                }
                if (chatLlm.fileContentText) {
                    content += `File Content: ${chatLlm.fileContentText}\n`;
                }
                isExecuted = true;
            }
        }

        // Execute LifeEvents
        if (!isExecuted) {
            const lifeEvent = await ModelLifeEvents.findOne({ _id: targetRecordIdObj });
            if (lifeEvent) {
                sourceType = 'lifeEvents';
                username = lifeEvent.username;
                content = `Title: ${lifeEvent.title}\n`;
                content += `Description: ${lifeEvent.description}\n`;
                if (lifeEvent.tags && lifeEvent.tags.length > 0) {
                    content += `Tags: ${lifeEvent.tags.join(', ')}\n`;
                }
                if (lifeEvent.aiCategory) {
                    content += `Category: ${lifeEvent.aiCategory}\n`;
                }
                if (lifeEvent.aiSubCategory) {
                    content += `Sub Category: ${lifeEvent.aiSubCategory}\n`;
                }
                if (lifeEvent.eventImpact) {
                    content += `Event Impact: ${lifeEvent.eventImpact}\n`;
                }
                isExecuted = true;
            }
        }

        // Execute InfoVault
        if (!isExecuted) {
            const infoVault = await ModelInfoVault.findOne({ _id: targetRecordIdObj });
            if (infoVault) {
                sourceType = 'infoVault';
                username = infoVault.username;
                content = `Name: ${infoVault.name}\n`;
                if (infoVault.nickname) {
                    content += `Nickname: ${infoVault.nickname}\n`;
                }
                if (infoVault.company) {
                    content += `Company: ${infoVault.company}\n`;
                }
                if (infoVault.jobTitle) {
                    content += `Job Title: ${infoVault.jobTitle}\n`;
                }
                if (infoVault.notes) {
                    content += `Notes: ${infoVault.notes}\n`;
                }
                if (infoVault.tags && infoVault.tags.length > 0) {
                    content += `Tags: ${infoVault.tags.join(', ')}\n`;
                }
                if (infoVault.aiSummary) {
                    content += `AI Summary: ${infoVault.aiSummary}\n`;
                }
                isExecuted = true;
            }
        }

        if (!sourceType || !username || !content.trim()) {
            return true; // Record not found or no content
        }

        // Get user API keys
        const apiKeys = await ModelUserApiKey.findOne({
            username,
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
            return true; // No API keys available
        }

        let modelProvider = '' as "groq" | "openrouter";
        let llmAuthToken = '';
        if (apiKeys.apiKeyOpenrouterValid) {
            modelProvider = 'openrouter';
            llmAuthToken = apiKeys.apiKeyOpenrouter;
        } else if (apiKeys.apiKeyGroqValid) {
            modelProvider = 'groq';
            llmAuthToken = apiKeys.apiKeyGroq;
        } else {
            return true; // No valid API key
        }

        // Get user languages
        const userInfo = await ModelUser.findOne({ username });
        if (!userInfo) {
            return true; // User not found
        }
        let languagesStr = '';
        if (userInfo.languages && userInfo.languages.length > 0) {
            languagesStr = userInfo.languages.join(', ');
        }

        // Generate keywords using LLM
        const keywordsResponse = await fetchLlmKeywords({
            argContent: content,
            llmAuthToken,
            modelProvider: modelProvider as 'groq' | 'openrouter',
            languagesStr,
        });

        if (!keywordsResponse) {
            return false;
        }

        // Combine all keywords into one array
        const allKeywords: string[] = [];

        if (keywordsResponse.oneWordKeywords && Array.isArray(keywordsResponse.oneWordKeywords)) {
            allKeywords.push(...keywordsResponse.oneWordKeywords.filter(k => typeof k === 'string'));
        }
        if (keywordsResponse.shortKeywords && Array.isArray(keywordsResponse.shortKeywords)) {
            allKeywords.push(...keywordsResponse.shortKeywords.filter(k => typeof k === 'string'));
        }
        if (keywordsResponse.longKeywords && Array.isArray(keywordsResponse.longKeywords)) {
            allKeywords.push(...keywordsResponse.longKeywords.filter(k => typeof k === 'string'));
        }
        if (keywordsResponse.seoFriendlyKeywords && Array.isArray(keywordsResponse.seoFriendlyKeywords)) {
            allKeywords.push(...keywordsResponse.seoFriendlyKeywords.filter(k => typeof k === 'string'));
        }
        if (keywordsResponse.oneLayerUpKeywords && Array.isArray(keywordsResponse.oneLayerUpKeywords)) {
            allKeywords.push(...keywordsResponse.oneLayerUpKeywords.filter(k => typeof k === 'string'));
        }

        // Remove duplicates and empty strings, trim whitespace
        const uniqueKeywords = Array.from(new Set(
            allKeywords
                .map(k => typeof k === 'string' ? k.trim() : '')
                .filter(k => k && k.length > 0)
        ));

        // Extract AI categorization fields - now as single strings
        let aiCategory = '';
        let aiSubCategory = '';
        let aiTopic = '';
        let aiSubTopic = '';

        if (keywordsResponse.aiCategory && typeof keywordsResponse.aiCategory === 'string') {
            aiCategory = keywordsResponse.aiCategory.trim();
        }
        if (keywordsResponse.aiSubCategory && typeof keywordsResponse.aiSubCategory === 'string') {
            aiSubCategory = keywordsResponse.aiSubCategory.trim();
        }
        if (keywordsResponse.aiTopic && typeof keywordsResponse.aiTopic === 'string') {
            aiTopic = keywordsResponse.aiTopic.trim();
        }
        if (keywordsResponse.aiSubTopic && typeof keywordsResponse.aiSubTopic === 'string') {
            aiSubTopic = keywordsResponse.aiSubTopic.trim();
        }

        if (uniqueKeywords.length === 0) {
            return true; // No keywords generated
        }

        // Delete existing keywords for this source
        await ModelLlmContextKeyword.deleteMany({
            username,
            metadataSourceType: sourceType,
            metadataSourceId: targetRecordIdObj,
        });

        const bulkInsert = uniqueKeywords.map(keyword => ({
            username,
            keyword,
            aiCategory: aiCategory,
            aiSubCategory: aiSubCategory,
            aiTopic: aiTopic,
            aiSubTopic: aiSubTopic,
            metadataSourceType: sourceType,
            metadataSourceId: targetRecordIdObj,
            hasEmbedding: false,
        }));

        await ModelLlmContextKeyword.insertMany(bulkInsert);

        return true;
    } catch (error) {
        console.error('generateKeywordsBySourceId: ', error);
        return false;
    }
};

export default generateKeywordsBySourceId;
