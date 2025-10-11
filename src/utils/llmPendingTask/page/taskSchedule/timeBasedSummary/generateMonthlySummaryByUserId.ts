import { NodeHtmlMarkdown } from 'node-html-markdown';
import { DateTime } from 'luxon';

import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import IUser from "../../../../../types/typesSchema/typesUser/SchemaUser.types";

import { ModelTaskSchedule } from '../../../../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import { tsTaskListSchedule } from '../../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';

import { ModelLifeEvents } from '../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ILifeEvents } from '../../../../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types';

import fetchLlmUnified from "../../../utils/fetchLlmUnified";

const getLifeEventsStr = async ({
    username,
    dateUtcStart,
    dateUtcEnd,
}: {
    username: string;
    dateUtcStart: Date;
    dateUtcEnd: Date;
}) => {
    try {
        const lifeEventsRecords = await ModelLifeEvents.find({
            username,
            $or: [
                {
                    eventDateUtc: {
                        $gte: dateUtcStart,
                        $lte: dateUtcEnd,
                    },
                },
            ]
        }) as ILifeEvents[];

        if (!lifeEventsRecords || lifeEventsRecords.length === 0) {
            return '';
        }

        let argContent = `Below are the life events added by the user:\n\n`;
        for (let index = 0; index < lifeEventsRecords.length; index++) {
            const element = lifeEventsRecords[index];

            argContent += `Life Event ${index + 1} -> title: ${element.title}.\n`;
            if (element.description.length >= 1) {
                const markdownContent = NodeHtmlMarkdown.translate(element.description);
                argContent += `Life Event ${index + 1} -> description: ${markdownContent}.\n`;
            }
            if (element.isStar) {
                argContent += `Life Event ${index + 1} -> isStar: Starred life event.\n`;
            }
            if (element.tags.length >= 1) {
                argContent += `Life Event ${index + 1} -> tags: ${element.tags.join(', ')}.\n`;
            }
            if (element.eventImpact) {
                argContent += `Life Event ${index + 1} -> eventImpact: ${element.eventImpact}.\n`;
            }
            if (element.eventDateUtc) {
                argContent += `Life Event ${index + 1} -> eventDateUtc: ${element.eventDateUtc}.\n`;
            }
            if (element.aiSummary) {
                argContent += `Life Event ${index + 1} -> aiSummary: ${element.aiSummary}.\n`;
            }
            if (element.aiTags.length >= 1) {
                argContent += `Life Event ${index + 1} -> aiTags: ${element.aiTags.join(', ')}.\n`;
            }

            argContent += '\n';
        }

        return argContent;
    } catch (error) {
        console.error(error);
        return '';
    }
};

const generateMonthlySummaryByUserId = async ({
    username,
    summaryDate,
}: {
    username: string;
    summaryDate: Date;
}) => {
    try {
        console.log('generateMonthlySummaryByUserId: ', username, summaryDate);
        const userRecords = await ModelUser.find({
            username,
        }) as IUser[];
        if (!userRecords || userRecords.length !== 1) {
            return true;
        }

        const userFirst = userRecords[0];

        // Get user's timezone offset in minutes
        const userTimezoneOffsetMinutes = userFirst.timeZoneUtcOffset;

        // Create DateTime in user's timezone
        const userDateTime = DateTime.fromJSDate(summaryDate, { zone: 'utc' })
            .plus({ minutes: userTimezoneOffsetMinutes });

        // Get start of month and end of month in user's timezone
        const startOfMonth = userDateTime.startOf('month');
        const endOfMonth = userDateTime.endOf('month');

        // Convert back to UTC for database queries
        const dateUtcStart = startOfMonth.minus({ minutes: userTimezoneOffsetMinutes }).toJSDate();
        const dateUtcEnd = endOfMonth.minus({ minutes: userTimezoneOffsetMinutes }).toJSDate();

        // Format for display
        const summaryDateOnly = startOfMonth.toISODate();
        const summaryDateUtc = startOfMonth.minus({ minutes: userTimezoneOffsetMinutes }).toJSDate();

        // get api keys
        const apiKeys = await ModelUserApiKey.findOne({
            username: userFirst.username,
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

        let modelProvider = '' as "groq" | "openrouter" | "openai" | "ollama";
        let apiEndpoint = '' as string;
        let llmAuthToken = '' as string;
        let modelName = '';
        if (apiKeys.apiKeyOpenrouterValid) {
            modelProvider = 'openrouter';
            llmAuthToken = apiKeys.apiKeyOpenrouter;
            modelName = 'openai/gpt-oss-20b';
        } else if (apiKeys.apiKeyGroqValid) {
            modelProvider = 'groq';
            llmAuthToken = apiKeys.apiKeyGroq;
            modelName = 'openai/gpt-oss-20b';
        } else if (apiKeys.apiKeyOllamaValid) {
            modelProvider = 'ollama';
            llmAuthToken = apiKeys.apiKeyOllamaEndpoint;
            modelName = 'gemma3:1b-it-q8_0';
            apiEndpoint = apiKeys.apiKeyOllamaEndpoint;
        }

        const lifeEventsStr = await getLifeEventsStr({
            username: userFirst.username,
            dateUtcStart,
            dateUtcEnd,
        });

        let argContent = `Below are the life events added by the user:\n\n`;
        argContent += `Life Events:\n${lifeEventsStr}\n`;

        let systemPrompt = `You create compact monthly summaries from user data.

Analyze life events. Write a concise summary focusing only on important information.

What to include:
- Key accomplishments
- Important decisions
- Significant problems and solutions
- Notable learnings or insights
- Meaningful patterns

What to exclude:
- Simple greetings (hello, hi, good morning, etc.)
- Small talk or casual pleasantries
- Trivial or routine interactions without substance

Format rules:
- Use bullet points starting with a dash (-)
- NO markdown formatting (no **, ##, or *italics*)
- Group by topic or time with clear headings
- Each bullet must be unique and relevant - avoid repetition
- Keep it brief and professional

Structure:
- One sentence overview of the month
- Group by topic (Work, Personal, etc.) or chronologically
- Only include significant items
- End with key takeaways or next steps if important

Be selective. Only include what matters for future reference.`;

        const llmResult = await fetchLlmUnified({
            // provider
            provider: modelProvider,
            apiKey: llmAuthToken,
            apiEndpoint: apiEndpoint,
            model: modelName,

            // messages
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: argContent },
            ],
        });
        console.log('llmResult: ', llmResult);
        console.log('llmResult.error: ', llmResult.error);

        // delete notes with title 'Monthly Summary - monthStr'
        let monthYearStr = startOfMonth.toJSDate().getFullYear().toString();
        let monthName = startOfMonth.toJSDate().toLocaleString('default', { month: 'long' });
        let monthNumber = startOfMonth.toJSDate().getMonth() + 1;
        let monthlyNotesTitle = `Monthly Summary by AI - ${monthYearStr} - ${monthName}`;
        console.log('monthlyNotesTitle: ', monthlyNotesTitle);
        await ModelLifeEvents.deleteMany({
            username: userFirst.username,
            title: monthlyNotesTitle,
        });

        const now = new Date();
        // update in life events record
        await ModelLifeEvents.create({
            username: userFirst.username,

            // identification - pagination
            eventDateUtc: startOfMonth.toJSDate(),
            eventDateYearStr: monthYearStr,
            eventDateYearMonthStr: monthYearStr + '-' + monthNumber.toString().padStart(2, '0'),

            // fields
            title: monthlyNotesTitle,
            description: llmResult.content,
            isStar: false,
            eventImpact: 'very-low',
            tags: [],
            aiSummary: llmResult.content,
            aiTags: [],
            aiSuggestions: '',
            aiCategory: 'Other',
            aiSubCategory: 'Other',

            // auto
            createdAtUtc: now,
            createdAtIpAddress: '',
            createdAtUserAgent: '',
            updatedAtUtc: now,
            updatedAtIpAddress: '',
            updatedAtUserAgent: '',
        });

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

const executeMonthlySummaryByUserId = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // get task schedule record
        const taskScheduleRecord = await ModelTaskSchedule.findOne({
            _id: targetRecordId,
        }) as tsTaskListSchedule;
        if (!taskScheduleRecord) {
            return true;
        }

        const userRecords = await ModelUser.find({
            username: taskScheduleRecord.username,
        }) as IUser[];

        if (!userRecords || userRecords.length !== 1) {
            return true;
        }

        const userFirst = userRecords[0];

        const ONE_DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

        const currentDate = new Date(
            new Date().valueOf() + userFirst.timeZoneUtcOffset * 60 * 1000 - ONE_DAY_IN_MILLISECONDS
        );
        const currentDateOnly = currentDate.toISOString().split('T')[0];

        // generate monthly summary by user id
        await generateMonthlySummaryByUserId({
            username: taskScheduleRecord.username,
            summaryDate: new Date(currentDateOnly + 'T00:00:00.000Z'),
        });

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

export {
    generateMonthlySummaryByUserId,
};
export default executeMonthlySummaryByUserId;
