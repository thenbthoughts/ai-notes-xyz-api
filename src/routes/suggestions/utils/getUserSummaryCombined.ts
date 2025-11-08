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
import { PipelineStage } from 'mongoose';
import { ModelTask } from '../../../schema/schemaTask/SchemaTask.schema';

// Function to get user info from the database
const getUserInfo = async (username: string) => {
    try {
        if (!username) return '';

        let promptUserInfo = '';

        const userInfo = await ModelUser.findOne({ username }).exec();
        if (userInfo) {
            if (userInfo.name !== '') {
                promptUserInfo += `My name is ${userInfo.name}. `;
            }
            if (userInfo.dateOfBirth && userInfo.dateOfBirth.length > 0) {
                promptUserInfo += `I was born on ${userInfo.dateOfBirth}. `;
            }
            if (userInfo.city && userInfo.city.length > 0) {
                promptUserInfo += `I live in city ${userInfo.city}. `;
            }
            if (userInfo.state && userInfo.state.length > 0) {
                promptUserInfo += `I live in state ${userInfo.state}. `;
            }
            if (userInfo.country && userInfo.country.length > 0) {
                promptUserInfo += `I am from ${userInfo.country}. `;
            }
            if (userInfo.zipCode && userInfo.zipCode.length > 0) {
                promptUserInfo += `My zip code is ${userInfo.zipCode}. `;
            }
            if (userInfo.bio && userInfo.bio.length > 0) {
                promptUserInfo += `Bio: ${userInfo.bio}. `;
            }

            const currentDateTime = new Date().toLocaleString();
            promptUserInfo += `Current date and time: ${currentDateTime}. `;

        }
        return promptUserInfo;
    } catch (error) {
        console.error('Error in getUserInfo:', error);
        return '';
    }
}

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

const getTasksStr = async ({
    username,
}: {
    username: string;
}): Promise<string> => {
    const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
    try {
        let tempStage = {} as PipelineStage;
        const stateDocument = [] as PipelineStage[];
        const stateDocumentCompletedTasks = [] as PipelineStage[];

        // auth
        tempStage = {
            $match: {
                username: username,
            }
        }
        stateDocument.push(tempStage);

        // stateDocument -> match
        tempStage = {
            $match: {
                isCompleted: false,
                isArchived: false,
            }
        }
        stateDocument.push(tempStage);

        // stageDocument -> add field
        const currentDate = new Date();
        tempStage = {
            $addFields: {
                // Calculate relevance score for initial filtering
                relevanceScore: {
                    $add: [
                        // Is pinned
                        {
                            $cond: {
                                if: { $eq: ['$isTaskPinned', true] },
                                then: 10000,
                                else: 0
                            }
                        },
                        // Priority scoring
                        {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$priority', 'very-high'] }, then: 100 },
                                    { case: { $eq: ['$priority', 'high'] }, then: 75 },
                                    { case: { $eq: ['$priority', 'medium'] }, then: 50 },
                                    { case: { $eq: ['$priority', 'low'] }, then: 25 },
                                    { case: { $eq: ['$priority', 'very-low'] }, then: 1 },
                                ],
                                default: 0
                            }
                        },
                        // Due date urgency
                        {
                            $cond: {
                                if: { $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', currentDate] }] },
                                then: 100, // Overdue
                                else: {
                                    $cond: {
                                        if: { $and: [{ $ne: ['$dueDate', null] }, { $lte: ['$dueDate', new Date(currentDate.getTime() + 3 * 24 * 60 * 60 * 1000)] }] },
                                        then: 50, // Due in 3 days
                                        else: {
                                            $cond: {
                                                if: { $and: [{ $ne: ['$dueDate', null] }, { $lte: ['$dueDate', new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000)] }] },
                                                then: 30, // Due in 7 days
                                                else: 0
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        // Recency bonus
                        {
                            $cond: {
                                if: { $gte: ['$updatedAtUtc', new Date(currentDate.getTime() - 1 * MILLISECONDS_PER_DAY)] },
                                then: 10, // Updated in last 1 day
                                else: {
                                    $cond: {
                                        if: { $gte: ['$updatedAtUtc', new Date(currentDate.getTime() - 3 * MILLISECONDS_PER_DAY)] },
                                        then: 8, // Updated in last 3 days
                                        else: {
                                            $cond: {
                                                if: { $gte: ['$updatedAtUtc', new Date(currentDate.getTime() - 7 * MILLISECONDS_PER_DAY)] },
                                                then: 5, // Updated in last 7 days
                                                else: {
                                                    $cond: {
                                                        if: { $gte: ['$updatedAtUtc', new Date(currentDate.getTime() - 15 * MILLISECONDS_PER_DAY)] },
                                                        then: 3, // Updated in last 15 days
                                                        else: 0
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                    ]
                }
            }
        }
        stateDocument.push(tempStage);

        // stateDocument -> sort
        tempStage = {
            $sort: {
                relevanceScore: -1,
            }
        }
        stateDocument.push(tempStage);

        // limit -> 100
        tempStage = {
            $limit: 100,
        }
        stateDocument.push(tempStage);

        // stateDocument -> lookup task status list
        tempStage = {
            $lookup: {
                from: 'taskStatusList',
                let: {
                    let_taskStatusId: '$taskStatusId',
                    let_taskWorkspaceId: '$taskWorkspaceId',
                },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    {
                                        $eq: ['$username', username]
                                    },
                                    {
                                        $eq: ['$_id', '$$let_taskStatusId']
                                    },
                                    {
                                        $eq: ['$taskWorkspaceId', '$$let_taskWorkspaceId']
                                    }
                                ]
                            }
                        }
                    }
                ],
                as: 'taskStatusList',
            }
        }
        stateDocument.push(tempStage);
        stateDocumentCompletedTasks.push(tempStage);

        // stateDocument -> lookup task workspace
        tempStage = {
            $lookup: {
                from: 'taskWorkspace',
                localField: 'taskWorkspaceId',
                foreignField: '_id',
                as: 'taskWorkspace',
            }
        }
        stateDocument.push(tempStage);
        stateDocumentCompletedTasks.push(tempStage);

        // stateDocument -> sub task
        tempStage = {
            $lookup: {
                from: 'tasksSub',
                localField: '_id',
                foreignField: 'parentTaskId',
                as: 'subTaskArr',
            }
        }
        stateDocument.push(tempStage);
        stateDocumentCompletedTasks.push(tempStage);

        // pipeline
        const resultTasksNotCompleted = await ModelTask.aggregate(stateDocument);

        const resultCompletedTasks = await ModelTask.aggregate([
            {
                $match: {
                    username: username,
                    $or: [
                        {
                            isCompleted: true,
                        },
                        {
                            isArchived: true,
                        }
                    ]
                }
            },
            {
                $sort: {
                    updatedAtUtc: -1,
                },
            },
            {
                $limit: 33,
            },
            ...stateDocumentCompletedTasks,
        ]);

        const resultTasks = [...resultTasksNotCompleted, ...resultCompletedTasks];

        if (resultTasks.length <= 0 && resultCompletedTasks.length <= 0) {
            return '';
        }

        // create task str
        let taskStr = 'Task List:\n';

        for (let index = 0; index < resultTasks.length; index++) {
            const task = resultTasks[index];
            taskStr += `ID: ${task._id}\n`;
            taskStr += `Title: ${task.title}\n`;
            if (task.description) {
                taskStr += `Description: ${task.description}\n`;
            }
            taskStr += `Priority: ${task.priority}\n`;
            if (task.dueDate) {
                taskStr += `Due Date: ${new Date(task.dueDate).toLocaleDateString()}\n`;
            }
            taskStr += `Task Completed: ${task.isCompleted ? 'Completed' : 'Incomplete'}\n`;
            taskStr += `Archived: ${task.isArchived ? 'Yes' : 'No'}\n`;
            if (task.labels && Array.isArray(task.labels) && task.labels.length > 0) {
                taskStr += `Labels: ${task.labels.join(', ')}\n`;
            }
            if (task.labelsAi && Array.isArray(task.labelsAi) && task.labelsAi.length > 0) {
                taskStr += `AI Labels: ${task.labelsAi.join(', ')}\n`;
            }
            if (task.taskWorkspace && Array.isArray(task.taskWorkspace) && task.taskWorkspace.length > 0) {
                taskStr += `Workspace: ${task.taskWorkspace[0].title}\n`;
            }
            if (task.taskStatusList && Array.isArray(task.taskStatusList) && task.taskStatusList.length > 0) {
                taskStr += `Status List: ${task.taskStatusList[0].statusName}\n`;
            }
            if (task.createdAtUtc) {
                taskStr += `Created: ${new Date(task.createdAtUtc).toLocaleDateString()}\n`;
            }
            if (task.updatedAtUtc) {
                taskStr += `Updated: ${new Date(task.updatedAtUtc).toLocaleDateString()}\n`;
            }
            if (task.subTaskArr && Array.isArray(task.subTaskArr) && task.subTaskArr.length > 0) {
                taskStr += `Subtasks:\n`;
                for (const subTask of task.subTaskArr) {
                    taskStr += `  - [${subTask.taskCompletedStatus ? 'x' : ' '}] ${subTask.title}\n`;
                }
            }
            taskStr += '\n';
        }

        return taskStr;
    } catch (error) {
        console.error('Error in getTasksStr:', error);
        return '';
    }
}

const getUserSummaryCombined = async (username: string): Promise<string> => {
    try {
        const userSummary = await getUserSummary(username);
        const tasksStr = await getTasksStr({ username });

        if (
            userSummary.summaryToday ||
            userSummary.summaryYesterday ||
            userSummary.summaryCurrentWeek ||
            userSummary.summaryLastWeek ||
            userSummary.summaryCurrentMonth ||
            userSummary.summaryLastMonth ||
            tasksStr.length > 0
        ) {
            // valid
        } else {
            return '';
        }

        // Prepare user data for LLM analysis with structured formatting
        let userDataString = `User Activity:\n\n`;

        // Add current date/time context
        const now = new Date();
        userDataString += `Current Date/Time: ${now.toISOString()}\n`;
        userDataString += `Local Date: ${now.toLocaleDateString()}\n`;
        userDataString += `Local Time: ${now.toLocaleTimeString()}\n\n`;

        // Add user info
        const promptUserInfo = await getUserInfo(username);
        if (promptUserInfo.length > 0) {
            userDataString += `User Info:\n${promptUserInfo}\n`;
        }

        // Add daily summaries
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

        // Add tasks
        if (tasksStr) {
            userDataString += `\n${tasksStr}`;
        }

        // System prompt for comprehensive user summary generation
        const systemPrompt = `
        You are a helpful AI coach.
        Review the user's activity data and create a short, clear, practical summary with a table of contents.
        Each table of contents should be a link to the corresponding section in the summary.
        Give the user 3-5 specific, actionable recommendations to help them improve their productivity, well-being, or progress toward their goals.
        The summary should be in markdown format.
        `;

        const userPrompt = `Look at this user's activity data and create a helpful summary:

${userDataString}

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
            temperature: 0.7,
            maxTokens: 8096,
            stream: false,
            toolChoice: 'none',
            openRouterApi: {
                provider: {
                    sort: 'throughput'
                }
            }
        });

        console.log('result', result);

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
