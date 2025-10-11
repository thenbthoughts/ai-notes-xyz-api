import { ModelLifeEvents } from '../../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { DateTime } from 'luxon';
import { ModelUser } from '../../../schema/schemaUser/SchemaUser.schema';
import IUser from '../../../types/typesSchema/typesUser/SchemaUser.types';
import { fetchLlmUnified, Message } from '../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { ILifeEvents } from '../../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { ModelUserApiKey } from '../../../schema/schemaUser/SchemaUserApiKey.schema';

import {
    getUserSummary,
} from './getUserSummary';

const formatLifeEventForLLM = (event: ILifeEvents | null, label: string): string => {
    if (!event) {
        return ``;
    }

    let content = `${label}:\n`;
    content += `  Title: ${event.title}\n`;

    if (event.description && event.description.length >= 1) {
        const markdownContent = NodeHtmlMarkdown.translate(event.description);
        content += `  Description: ${markdownContent}\n`;
    }

    if (event.isStar) {
        content += `  Status: ⭐ Starred event\n`;
    }

    if (event.tags && event.tags.length >= 1) {
        content += `  Tags: ${event.tags.join(', ')}\n`;
    }

    if (event.eventImpact) {
        content += `  Impact: ${event.eventImpact}\n`;
    }

    if (event.eventDateUtc) {
        content += `  Date: ${event.eventDateUtc}\n`;
    }

    if (event.aiSummary) {
        content += `  AI Summary: ${event.aiSummary}\n`;
    }

    if (event.aiTags && event.aiTags.length >= 1) {
        content += `  AI Tags: ${event.aiTags.join(', ')}\n`;
    }

    content += '\n';
    return content;
};

const getUserSummaryCombined = async (username: string): Promise<string> => {
    try {
        const userSummary = await getUserSummary(username);

        if (!userSummary) {
            return '';
        }

        if (
            userSummary.summaryToday ||
            userSummary.summaryYesterday ||
            userSummary.summaryCurrentWeek ||
            userSummary.summaryLastWeek ||
            userSummary.summaryCurrentMonth ||
            userSummary.summaryLastMonth
        ) {
            // valid
        } else {
            return '';
        }

        // Prepare user data for LLM analysis with structured formatting
        let userDataString = `User Activity:\n\n`;
        if (userSummary.summaryToday || userSummary.summaryYesterday) {
            userDataString += '=== DAILY SUMMARIES ===\n\n';
        }
        if (userSummary.summaryToday) {
            userDataString += formatLifeEventForLLM(userSummary.summaryToday, 'Today');
        }
        if (userSummary.summaryYesterday) {
            userDataString += formatLifeEventForLLM(userSummary.summaryYesterday, 'Yesterday');
        }
        if (userSummary.summaryCurrentWeek || userSummary.summaryLastWeek) {
            userDataString += '\n=== WEEKLY SUMMARIES ===\n\n';
        }
        if (userSummary.summaryCurrentWeek) {
            userDataString += formatLifeEventForLLM(userSummary.summaryCurrentWeek, 'Current Week');
        }
        if (userSummary.summaryLastWeek) {
            userDataString += formatLifeEventForLLM(userSummary.summaryLastWeek, 'Last Week');
        }

        if (userSummary.summaryCurrentMonth || userSummary.summaryLastMonth) {
            userDataString += '\n=== MONTHLY SUMMARIES ===\n\n';
        }
        if (userSummary.summaryCurrentMonth) {
            userDataString += formatLifeEventForLLM(userSummary.summaryCurrentMonth, 'Current Month');
        }
        if (userSummary.summaryLastMonth) {
            userDataString += formatLifeEventForLLM(userSummary.summaryLastMonth, 'Last Month');
        }

        // System prompt for comprehensive user summary generation
        const systemPrompt = `You are an AI analyst who helps users understand their activity and progress. Your job is to look at their daily, weekly, and monthly summaries and create a clear, helpful overview.

What to do:
1. Find patterns in what the user is doing
2. Point out their wins and important moments
3. Notice what they do regularly
4. Give practical suggestions they can actually use
5. Be friendly and encouraging

How to write the summary:
- Start with a quick overview (2-3 sentences about what's happening overall)
- Talk about recent days (what they did today and yesterday)
- Talk about the week (what patterns you see)
- Talk about the month (bigger picture and progress)
- End with 3-5 specific takeaways or next steps

Writing rules:
- Use simple, clear language
- Use markdown only (no HTML)
- Use ## for section headers
- Use bullet points for lists
- Use **bold** for important points
- Keep it easy to read and scan

Your goal: Help the user see what they're doing well, where they can improve, and what to do next. Be specific and practical.`;

        const userPrompt = `Look at this user's activity data and create a helpful summary:

${userDataString}

Give them:
- What patterns you see
- What they're doing well
- What's changed over time
- 3-5 specific things they can do or think about

Make it practical and easy to understand.`;

        // Get user API keys
        const userInfoApiKey = await ModelUserApiKey.findOne({ username }).exec();
        if (!userInfoApiKey) {
            return '';
        }

        // Determine provider and API key
        let modelProvider = '' as "groq" | "openrouter" | "openai" | "ollama";
        let apiEndpoint = '' as string;
        let llmAuthToken = '' as string;
        let modelName = '';
        if (userInfoApiKey.apiKeyOpenrouterValid) {
            modelProvider = 'openrouter';
            llmAuthToken = userInfoApiKey.apiKeyOpenrouter;
            modelName = 'openai/gpt-oss-20b';
        } else if (userInfoApiKey.apiKeyGroqValid) {
            modelProvider = 'groq';
            llmAuthToken = userInfoApiKey.apiKeyGroq;
            modelName = 'openai/gpt-oss-20b';
        }

        const messages: Message[] = [
            {
                role: 'system',
                content: systemPrompt,
            },
            {
                role: 'user',
                content: userPrompt,
            },
        ];

        // Call LLM to generate the summary
        const result = await fetchLlmUnified({
            provider: modelProvider,
            apiKey: llmAuthToken,
            apiEndpoint: apiEndpoint,
            model: modelName,
            messages: messages,
            temperature: 1,
            maxTokens: 8096,
            stream: false,
            toolChoice: 'none',
            openRouterApi: {
                provider: {
                    sort: 'throughput'
                }
            }
        });

        if (!result.success) {
            console.error('Failed to generate user summary:', result.error);
            return '';
        }

        let resultContent = result.content;

        // Replace all <br> tags with newlines
        resultContent = resultContent.replace(/<br>/gi, '\n');

        return resultContent;
    } catch (error) {
        console.error('Error in getUserSummaryCombined:', error);
        return '';
    }
};

export {
    getUserSummaryCombined,
};
