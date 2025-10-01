import mongoose from 'mongoose';
import { NodeHtmlMarkdown } from 'node-html-markdown';

import { ModelUserApiKey } from "../../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import IUser from "../../../../../types/typesSchema/typesUser/SchemaUser.types";

import { ModelNotes } from "../../../../../schema/schemaNotes/SchemaNotes.schema";
import { INotes } from '../../../../../types/typesSchema/typesSchemaNotes/SchemaNotes.types';
import { ModelNotesWorkspace } from "../../../../../schema/schemaNotes/SchemaNotesWorkspace.schema";
import { INotesWorkspace } from "../../../../../types/typesSchema/typesSchemaNotes/SchemaNotesWorkspace.types";

import { ModelTask } from "../../../../../schema/schemaTask/SchemaTask.schema";
import { tsTaskList } from "../../../../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types";
import { ModelTaskWorkspace } from "../../../../../schema/schemaTask/SchemaTaskWorkspace.schema";
import { ITaskWorkspace } from "../../../../../types/typesSchema/typesSchemaTask/SchemaTaskWorkspace.types";
import { ModelTaskStatusList } from "../../../../../schema/schemaTask/SchemaTaskStatusList.schema";
import { tsTaskStatusList } from "../../../../../types/typesSchema/typesSchemaTask/SchemaTaskStatusList.types";

import { ModelTaskSchedule } from '../../../../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import { tsTaskListSchedule } from '../../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';

import { ModelLifeEvents } from '../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ILifeEvents } from '../../../../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types';

import { ModelChatLlm } from '../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { IChatLlm } from '../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types';
import { ModelChatLlmThread } from '../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { IChatLlmThread } from '../../../../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types';

import fetchLlmUnified from "../../../utils/fetchLlmUnified";

const getDataNotesStr = async ({
    username,
    dateUtcStart,
    dateUtcEnd,
}: {
    username: string;
    dateUtcStart: Date;
    dateUtcEnd: Date;
}) => {
    try {
        interface INotesAggregate extends INotes {
            notesWorkspace: INotesWorkspace[];
        }

        const notesRecords = await ModelNotes.aggregate([
            {
                $match: {
                    username,
                    $or: [
                        {
                            createdAtUtc: {
                                $gte: dateUtcStart,
                                $lte: dateUtcEnd,
                            },
                        },
                        {
                            updatedAtUtc: {
                                $gte: dateUtcStart,
                                $lte: dateUtcEnd,
                            },
                        },
                    ]
                },
            },
            {
                $project: {
                    _id: 1,
                    username: 1,
                    title: 1,
                    description: 1,
                    isStar: 1,
                    tags: 1,
                    notesWorkspaceId: 1,
                    createdAtUtc: 1,
                    updatedAtUtc: 1,
                },
            },
            {
                $lookup: {
                    from: 'notesWorkspace',
                    localField: 'notesWorkspaceId',
                    foreignField: '_id',
                    as: 'notesWorkspace',
                },
            },
            {
                $sort: {
                    createdAtUtc: -1,
                },
            },
        ]) as INotesAggregate[];

        if (!notesRecords || notesRecords.length === 0) {
            return '';
        }

        let argContent = `Below are the notes added by the user:\n\n`;
        for (let index = 0; index < notesRecords.length; index++) {
            const element = notesRecords[index];

            argContent += `Note ${index + 1} -> title: ${element.title}.\n`;
            if (element.description.length >= 1) {
                const markdownContent = NodeHtmlMarkdown.translate(element.description);
                argContent += `Note ${index + 1} -> description: ${markdownContent}.\n`;
            }
            if (element.isStar) {
                argContent += `Note ${index + 1} -> isStar: Starred life event.\n`;
            }
            if (element.tags.length >= 1) {
                argContent += `Note ${index + 1} -> tags: ${element.tags.join(', ')}.\n`;
            }
            if (element.notesWorkspaceId) {
                const notesWorkspace = await ModelNotesWorkspace.findOne({
                    _id: element.notesWorkspaceId,
                }) as INotesWorkspace;
                if (notesWorkspace) {
                    argContent += `Note ${index + 1} -> workspace: ${notesWorkspace.title}.\n`;
                }
            }

            if (element.createdAtUtc) {
                argContent += `Note ${index + 1} -> createdAtUtc: ${element.createdAtUtc}.\n`;
            }
            if (element.updatedAtUtc) {
                argContent += `Note ${index + 1} -> updatedAtUtc: ${element.updatedAtUtc}.\n`;
            }

            argContent += '\n';
        }

        return argContent;
    } catch (error) {
        console.error(error);
        return '';
    }
};

const getDataTaskStr = async ({
    username,
    dateUtcStart,
    dateUtcEnd,
}: {
    username: string;
    dateUtcStart: Date;
    dateUtcEnd: Date;
}) => {
    try {
        interface tsTaskListAggregate extends tsTaskList {
            taskWorkspace: ITaskWorkspace[];
            taskStatusList: tsTaskStatusList[];
        }

        const taskRecords = await ModelTask.aggregate([
            {
                $match: {
                    username,
                    $or: [
                        {
                            createdAtUtc: {
                                $gte: dateUtcStart,
                                $lte: dateUtcEnd,
                            },
                        },
                        {
                            updatedAtUtc: {
                                $gte: dateUtcStart,
                                $lte: dateUtcEnd,
                            },
                        },
                    ]
                },
            },
            {
                $lookup: {
                    from: 'taskWorkspace',
                    localField: 'taskWorkspaceId',
                    foreignField: '_id',
                    as: 'taskWorkspace',
                },
            },
            {
                $lookup: {
                    from: 'taskStatusList',
                    localField: 'taskStatusId',
                    foreignField: '_id',
                    as: 'taskStatusList',
                },
            },
            {
                $sort: {
                    createdAtUtc: -1,
                },
            },
        ]) as tsTaskListAggregate[];

        if (!taskRecords || taskRecords.length === 0) {
            return '';
        }

        let argContent = `Below are the tasks added by the user:\n\n`;
        for (let index = 0; index < taskRecords.length; index++) {
            const element = taskRecords[index];

            argContent += `Task ${index + 1} -> title: ${element.title}.\n`;
            if (element.description.length >= 1) {
                const markdownContent = NodeHtmlMarkdown.translate(element.description);
                argContent += `Task ${index + 1} -> description: ${markdownContent}.\n`;
            }

            if (element.taskWorkspaceId) {
                const taskWorkspace = await ModelTaskWorkspace.findOne({
                    _id: element.taskWorkspaceId,
                }) as ITaskWorkspace;
                if (taskWorkspace) {
                    argContent += `Task ${index + 1} -> workspace: ${taskWorkspace.title}.\n`;
                }
            }
            if (element.taskStatusId) {
                const taskStatus = await ModelTaskStatusList.findOne({
                    _id: element.taskStatusId,
                }) as tsTaskStatusList;
                if (taskStatus) {
                    argContent += `Task ${index + 1} -> status: ${taskStatus.statusTitle}.\n`;
                }
            }
            if (element.isArchived) {
                argContent += `Task ${index + 1} -> isArchived: ${element.isArchived ? 'Yes' : 'No'}.\n`;
            }
            if (element.isCompleted) {
                argContent += `Task ${index + 1} -> isCompleted: ${element.isCompleted ? 'Yes' : 'No'}.\n`;
            }
            if (element.priority.length >= 1) {
                argContent += `Task ${index + 1} -> priority: ${element.priority}.\n`;
            }
            if (element.dueDate) {
                argContent += `Task ${index + 1} -> dueDate: ${element.dueDate}.\n`;
            }
            if (element.comments?.length >= 1) {
                argContent += `Task ${index + 1} -> comments: ${element.comments.join(', ')}.\n`;
            }
            if (element.labels.length >= 1) {
                argContent += `Task ${index + 1} -> labels: ${element.labels.join(', ')}.\n`;
            }
            if (element.labelsAi.length >= 1) {
                argContent += `Task ${index + 1} -> labelsAi: ${element.labelsAi.join(', ')}.\n`;
            }
            if (element.isTaskPinned) {
                argContent += `Task ${index + 1} -> isTaskPinned: ${element.isTaskPinned ? 'Yes' : 'No'}.\n`;
            }

            if (element.taskWorkspace.length >= 1) {
                argContent += `Task ${index + 1} -> workspace: ${element.taskWorkspace[0].title}.\n`;
            }
            if (element.taskStatusList.length >= 1) {
                argContent += `Task ${index + 1} -> status: ${element.taskStatusList[0].statusTitle}.\n`;
            }

            if (element.createdAtUtc) {
                argContent += `Task ${index + 1} -> createdAtUtc: ${element.createdAtUtc}.\n`;
            }
            if (element.updatedAtUtc) {
                argContent += `Task ${index + 1} -> updatedAtUtc: ${element.updatedAtUtc}.\n`;
            }

            argContent += '\n';
        }

        return argContent;
    } catch (error) {
        console.error(error);
        return '';
    }
};

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

const getChatStr = async ({
    username,
    dateUtcStart,
    dateUtcEnd,
}: {
    username: string;
    dateUtcStart: Date;
    dateUtcEnd: Date;
}) => {
    try {
        const chatThreadRecords = await ModelChatLlmThread.find({
            username,
            updatedAtUtc: {
                $gte: dateUtcStart,
                $lte: dateUtcEnd,
            },
        }) as IChatLlmThread[];

        let argContent = `Below are the chat messages added by the user:\n\n`;
        for (let index = 0; index < chatThreadRecords.length; index++) {
            const element = chatThreadRecords[index];
            const chatRecords = await ModelChatLlm.find({
                threadId: element._id,
            }) as IChatLlm[];

            if (!chatRecords || chatRecords.length === 0) {
                continue;
            }

            for (let index = 0; index < chatRecords.length; index++) {
                const element = chatRecords[index];
                argContent += `Chat ${index + 1} -> content: ${element.content}.\n`;
            }

            argContent += '\n';
        }


        return argContent.trim();
    } catch (error) {
        console.error(error);
        return '';
    }
}

const generateDailySummaryByUserId = async ({
    username,
    summaryDate,
}: {
    username: string;
    summaryDate: Date;
}) => {
    try {
        console.log('generateDailySummaryByUserId: ', username, summaryDate);
        const userRecords = await ModelUser.find({
            username,
        }) as IUser[];
        if (!userRecords || userRecords.length !== 1) {
            return true;
        }

        const userFirst = userRecords[0];

        // construct current date
        const summaryDateUtc = new Date(summaryDate);
        const summaryDateOnly = summaryDateUtc.toISOString().split('T')[0];
        let dateUtcStart = new Date(summaryDateUtc.setHours(0, 0, 0, 0));
        let dateUtcEnd = new Date(summaryDateUtc.setHours(23, 59, 59, 999));

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

        const notesStr = await getDataNotesStr({
            username: userFirst.username,
            dateUtcStart,
            dateUtcEnd,
        });
        const taskStr = await getDataTaskStr({
            username: userFirst.username,
            dateUtcStart,
            dateUtcEnd,
        });
        const lifeEventsStr = await getLifeEventsStr({
            username: userFirst.username,
            dateUtcStart,
            dateUtcEnd,
        });
        const chatStr = await getChatStr({
            username: userFirst.username,
            dateUtcStart,
            dateUtcEnd,
        });

        let argContent = `Below are the notes and tasks added by the user:\n\n`;
        argContent += `Notes:\n${notesStr}\n`;
        argContent += `Tasks:\n${taskStr}\n`;
        argContent += `Life Events:\n${lifeEventsStr}\n`;
        argContent += `Chat:\n${chatStr}\n`;

        let systemPrompt = `Create a detailed daily summary of the notes and tasks added by the user. Group multiple notes and tasks into a single section if they are related.
        Focus on creating a comprehensive summary that captures the key activities, accomplishments, and important events from the day.
        Organize the content logically by themes or time periods when possible.
        Include specific details and context that would be meaningful for future reference.
        The summary should be written in a clear, narrative style that flows naturally and provides insight into the user's daily activities and progress.
        Avoid simply listing items and instead weave them into a cohesive story of the day's events and achievements.
        The summary should be not in markdown format and should be in a simple language.
        Create bullet points for the summary.
        `;

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

        // create a new notes record with the summary
        let workspaceId = null as mongoose.Schema.Types.ObjectId | null;

        const workspaceNotesName = 'Ai Daily Summary';

        const notesWorkspaceRecords = await ModelNotesWorkspace.findOne({
            username: userFirst.username,
            title: workspaceNotesName,
        }) as INotesWorkspace | null;
        if (notesWorkspaceRecords) {
            workspaceId = notesWorkspaceRecords._id as mongoose.Schema.Types.ObjectId;
        } else {
            const newNotesWorkspaceRecord = await ModelNotesWorkspace.create({
                username: userFirst.username,
                title: workspaceNotesName,
                description: '',
                isStar: false,
                tags: [],
            });
            workspaceId = newNotesWorkspaceRecord._id as mongoose.Schema.Types.ObjectId;
        }

        // delete notes with title 'Daily Summary - currentDateOnly'
        let dailyNotesTitle = `Daily Summary by AI - ${summaryDateOnly}`;
        await ModelLifeEvents.deleteMany({
            username: userFirst.username,
            title: dailyNotesTitle,
        });

        const now = new Date();
        // update in life events record
        await ModelLifeEvents.create({
            username: userFirst.username,

            // identification - pagination
            eventDateUtc: summaryDateUtc,
            eventDateYearStr: (summaryDateUtc).getFullYear().toString(),
            eventDateYearMonthStr: (summaryDateUtc).getFullYear().toString() + '-' + (summaryDateUtc).getMonth().toString().padStart(2, '0'),

            // fields
            title: dailyNotesTitle,
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

const executeDailySummaryByUserId = async ({
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

        // generate daily summary by user id
        await generateDailySummaryByUserId({
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
    generateDailySummaryByUserId,
};
export default executeDailySummaryByUserId;
