import mongoose from "mongoose";
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { fetchLlmUnified, Message } from "../../../../utils/fetchLlmUnified";
import { jsonObjRepairCustom } from "../../../../../common/jsonObjRepairCustom";

import { ModelUserApiKey } from "../../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelFaq } from "../../../../../../schema/schemaFaq/SchemaFaq.schema";

import { ModelNotes } from "../../../../../../schema/schemaNotes/SchemaNotes.schema";
import { ModelTask } from "../../../../../../schema/schemaTask/SchemaTask.schema";
import { ModelChatLlm } from "../../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelLifeEvents } from "../../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ModelInfoVault } from "../../../../../../schema/schemaInfoVault/SchemaInfoVault.schema";

interface tsFaqResponse {
    faqs?: Array<{
        question: string;
        answer: string;
        aiCategory?: string;
        aiSubCategory?: string;
        tags?: string[];
    }>;
}

/**
 * Extract content from source record based on source type
 */
const extractContentFromSource = async (
    sourceType: string,
    targetRecordIdObj: mongoose.Types.ObjectId
): Promise<{ username: string; content: string } | null> => {
    let username = '';
    let content = '';

    // Extract from Notes
    if (sourceType === 'notes') {
        const noteAggregate = await ModelNotes.aggregate([
            { $match: { _id: targetRecordIdObj } },
            {
                $lookup: {
                    from: 'notesWorkspace',
                    localField: 'notesWorkspaceId',
                    foreignField: '_id',
                    as: 'notesWorkspace'
                }
            },
            { $limit: 1 }
        ]);

        if (noteAggregate && noteAggregate.length > 0) {
            const note = noteAggregate[0];
            username = note.username;
            content = `Title: ${note.title}\n`;
            if (note.description) {
                const markdownContent = NodeHtmlMarkdown.translate(note.description);
                content += `Description: ${markdownContent}\n`;
            }
            if (note.tags && note.tags.length > 0) {
                content += `Tags: ${note.tags.join(', ')}\n`;
            }
            if (note.isStar) {
                content += `Is Star: Starred\n`;
            }
            if (note.notesWorkspace && note.notesWorkspace.length > 0 && note.notesWorkspace[0].name) {
                content += `Workspace: ${note.notesWorkspace[0].name}\n`;
            }
            return { username, content };
        }
    }

    // Extract from Tasks
    if (sourceType === 'tasks') {
        const taskAggregate = await ModelTask.aggregate([
            { $match: { _id: targetRecordIdObj } },
            {
                $lookup: {
                    from: 'taskWorkspace',
                    localField: 'taskWorkspaceId',
                    foreignField: '_id',
                    as: 'taskWorkspace'
                }
            },
            { $limit: 1 }
        ]);

        if (taskAggregate && taskAggregate.length > 0) {
            const task = taskAggregate[0];
            username = task.username;
            content = `Title: ${task.title}\n`;
            if (task.description) {
                content += `Description: ${task.description}\n`;
            }
            if (task.labels && task.labels.length > 0) {
                content += `Labels: ${task.labels.join(', ')}\n`;
            }
            if (task.priority) {
                content += `Priority: ${task.priority}\n`;
            }
            if (task.dueDate) {
                content += `Due Date: ${task.dueDate}\n`;
            }
            if (task.isCompleted) {
                content += `Status: Completed\n`;
            }
            if (task.taskWorkspace && task.taskWorkspace.length > 0 && task.taskWorkspace[0].name) {
                content += `Workspace: ${task.taskWorkspace[0].name}\n`;
            }
            return { username, content };
        }
    }

    // Extract from ChatLlm
    if (sourceType === 'chatLlm') {
        const chatLlmAggregate = await ModelChatLlm.aggregate([
            { $match: { _id: targetRecordIdObj } },
            {
                $lookup: {
                    from: 'chatLlmThread',
                    localField: 'threadId',
                    foreignField: '_id',
                    as: 'thread'
                }
            },
            { $limit: 1 }
        ]);

        if (chatLlmAggregate && chatLlmAggregate.length > 0) {
            const chatLlm = chatLlmAggregate[0];
            username = chatLlm.username;
            content = `Content: ${chatLlm.content}\n`;
            if (chatLlm.tags && chatLlm.tags.length > 0) {
                content += `Tags: ${chatLlm.tags.join(', ')}\n`;
            }
            if (chatLlm.fileContentText) {
                content += `File Content: ${chatLlm.fileContentText}\n`;
            }
            if (chatLlm.thread && chatLlm.thread.length > 0) {
                if (chatLlm.thread[0].threadTitle) {
                    content += `Thread Title: ${chatLlm.thread[0].threadTitle}\n`;
                }
                if (chatLlm.thread[0].aiSummary) {
                    content += `Thread AI Summary: ${chatLlm.thread[0].aiSummary}\n`;
                }
            }
            return { username, content };
        }
    }


    // Extract from LifeEvents
    if (sourceType === 'lifeEvents') {
        const lifeEvent = await ModelLifeEvents.findOne({ _id: targetRecordIdObj });
        if (lifeEvent) {
            username = lifeEvent.username;
            content = `Title: ${lifeEvent.title}\n`;
            if (lifeEvent.description) {
                content += `Description: ${lifeEvent.description}\n`;
            }
            if (lifeEvent.tags && lifeEvent.tags.length > 0) {
                content += `Tags: ${lifeEvent.tags.join(', ')}\n`;
            }
            if (lifeEvent.aiCategory) {
                content += `Category: ${lifeEvent.aiCategory}\n`;
            }
            if (lifeEvent.eventImpact) {
                content += `Event Impact: ${lifeEvent.eventImpact}\n`;
            }
            if (lifeEvent.eventDateUtc) {
                content += `Event Date: ${lifeEvent.eventDateUtc}\n`;
            }
            return { username, content };
        }
    }

    // Extract from InfoVault
    if (sourceType === 'infoVault') {
        const infoVault = await ModelInfoVault.findOne({ _id: targetRecordIdObj });
        if (infoVault) {
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
            if (infoVault.infoVaultType) {
                content += `Type: ${infoVault.infoVaultType}\n`;
            }
            return { username, content };
        }
    }

    return null;
};

/**
 * Generate FAQs using LLM
 */
const generateFaqsWithLlm = async ({
    content,
    sourceType,
    llmAuthToken,
    modelProvider,
}: {
    content: string;
    sourceType: string;
    llmAuthToken: string;
    modelProvider: 'groq' | 'openrouter';
}): Promise<tsFaqResponse> => {
    let apiEndpoint = '';
    let modelName = '';
    if (modelProvider === 'openrouter') {
        apiEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
        modelName = 'openai/gpt-oss-20b';
    } else if (modelProvider === 'groq') {
        apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
        modelName = 'openai/gpt-oss-20b';
    }

    const systemPrompt = `You are an AI assistant specialized in generating Frequently Asked Questions (FAQs) from content.

Guidelines:
- Base all questions and answers strictly on the provided content.
- Do not make assumptions or include information not explicitly stated in the source.
- Provide detailed, helpful answers that address the question directly.
- Include relevant category and subcategory for each FAQ.
- Use appropriate tags to categorize FAQs.

Output the result in JSON format:
{
    "faqs": [
        {
            "question": "What is...?",
            "answer": "Detailed answer explaining...",
            "aiCategory": "Category name",
            "aiSubCategory": "Subcategory name",
            "tags": ["tag1", "tag2"]
        }
    ]
}`;

    const messages: Message[] = [
        {
            role: "system",
            content: systemPrompt,
        },
        {
            role: "user",
            content: `Source Type: ${sourceType}\n\nContent:\n${content}`,
        }
    ];

    try {
        const result = await fetchLlmUnified({
            provider: modelProvider,
            apiKey: llmAuthToken,
            apiEndpoint: apiEndpoint,
            model: modelName,
            messages: messages,
            temperature: 0.7,
            maxTokens: 2048,
            responseFormat: 'json_object',
            stream: false,
            toolChoice: 'none',
        });

        let jsonStr = result.content.trim();
        jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '');
        jsonStr = jsonStr.trim();

        let faqObj: tsFaqResponse;
        try {
            faqObj = JSON.parse(jsonStr) as tsFaqResponse;
        } catch (error) {
            const repairedContent = jsonObjRepairCustom(jsonStr);
            faqObj = JSON.parse(repairedContent) as tsFaqResponse;
        }

        return faqObj;
    } catch (error) {
        console.error('Error generating FAQs:', error);
        return { faqs: [] };
    }
};

/**
 * Main function to generate FAQs by source ID
 */
const generateFaqBySourceId = async ({
    targetRecordId,
    sourceType,
}: {
    targetRecordId: string | null;
    sourceType: string;
}) => {
    try {
        if (!targetRecordId || !sourceType) {
            return true;
        }

        const targetRecordIdObj = mongoose.Types.ObjectId.createFromHexString(targetRecordId.toString());
        if (!targetRecordIdObj) {
            return true;
        }

        // Extract content from source
        const sourceData = await extractContentFromSource(sourceType, targetRecordIdObj);
        if (!sourceData || !sourceData.content.trim()) {
            return true;
        }

        const { username, content } = sourceData;

        // Get user API keys
        const apiKeys = await ModelUserApiKey.findOne({
            username: username,
            $or: [
                { apiKeyGroqValid: true },
                { apiKeyOpenrouterValid: true },
            ]
        });

        if (!apiKeys) {
            return true;
        }

        let modelProvider: 'groq' | 'openrouter' = 'groq';
        let llmAuthToken = '';
        if (apiKeys.apiKeyOpenrouterValid) {
            modelProvider = 'openrouter';
            llmAuthToken = apiKeys.apiKeyOpenrouter;
        } else if (apiKeys.apiKeyGroqValid) {
            modelProvider = 'groq';
            llmAuthToken = apiKeys.apiKeyGroq;
        }

        // Generate FAQs using LLM
        const faqResponse = await generateFaqsWithLlm({
            content,
            sourceType,
            llmAuthToken,
            modelProvider,
        });

        if (!faqResponse.faqs || faqResponse.faqs.length === 0) {
            return true;
        }

        // Save FAQs to database
        const faqsToCreate = faqResponse.faqs.map(faq => ({
            username: username,
            question: faq.question || '',
            answer: faq.answer || '',
            aiCategory: faq.aiCategory || '',
            aiSubCategory: faq.aiSubCategory || '',
            tags: Array.isArray(faq.tags) ? faq.tags : [],
            metadataSourceType: sourceType,
            metadataSourceId: targetRecordIdObj,
            hasEmbedding: false,
            vectorEmbeddingStr: '',
            isActive: true,
            cronExpressionArr: [],
            scheduleExecutionTimeArr: [],
            scheduleExecutedTimeArr: [],
            executedTimes: 0,
            timezoneName: 'UTC',
            timezoneOffset: 0,
            createdAtUtc: new Date(),
            createdAtIpAddress: '',
            createdAtUserAgent: '',
            updatedAtUtc: new Date(),
            updatedAtIpAddress: '',
            updatedAtUserAgent: '',
        }));

        // delete existing FAQs for this source
        await ModelFaq.deleteMany({
            username: username,
            metadataSourceType: sourceType,
            metadataSourceId: targetRecordIdObj,
        });

        // insert new FAQs
        await ModelFaq.insertMany(faqsToCreate);

        return true;
    } catch (error) {
        console.error('Error in generateFaqBySourceId:', error);
        return false;
    }
};

export default generateFaqBySourceId;

