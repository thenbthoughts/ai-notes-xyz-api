import mongoose from "mongoose";
import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";
import { NodeHtmlMarkdown } from "node-html-markdown";

import openrouterMarketing from "../../../../config/openrouterMarketing";

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelUser } from '../../../../schema/schemaUser/SchemaUser.schema';
import { ModelTask } from "../../../../schema/schemaTask/SchemaTask.schema";
import { ModelNotes } from "../../../../schema/schemaNotes/SchemaNotes.schema";
import {
    ModelChatLlmThreadContextReference
} from "../../../../schema/schemaChatLlm/SchemaChatLlmThreadContextReference.schema";

import { tsUserApiKey } from "../../../../utils/llm/llmCommonFunc";

import { INotes } from "../../../../types/typesSchema/typesSchemaNotes/SchemaNotes.types";
import { IChatLlmThread } from "../../../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types";
import { IChatLlmThreadContextReference } from "../../../../types/typesSchema/typesChatLlm/SchemaChatLlmThreadContextReference.types";
import { INotesWorkspace } from "../../../../types/typesSchema/typesSchemaNotes/SchemaNotesWorkspace.types";

interface Message {
    role: string;
    content: string;
}

// Function to get the last 20 conversations from MongoDB
const getLast20Conversations = async ({
    // thread
    threadId,

    // auth
    username,
}: {
    threadId: mongoose.Types.ObjectId,
    username: string;
}): Promise<Message[]> => {
    const conversations = await ModelChatLlm
        .find({
            username,
            type: "text",
            threadId: threadId,
        })
        .sort({ createdAtUtc: -1 })
        .exec();

    return conversations.map((convo: { content: string; }) => ({
        role: 'user',
        content: convo.content
    }));
}

interface Message {
    role: string;
    content: string;
}

interface RequestData {
    messages: Message[];
    model: string;
    temperature: number;
    max_tokens: number;
    top_p: number;
    stream: boolean;
    stop: null | string;
}

const fetchLlm = async ({
    argMessages,
    modelName,

    llmAuthToken,
    provider,
}: {
    argMessages: Message[];
    modelName: string,

    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}): Promise<string> => {
    try {
        let apiEndpoint = '';
        if (provider === 'openrouter') {
            apiEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
        } else if (provider === 'groq') {
            apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
        }

        const data: RequestData = {
            messages: argMessages,
            model: modelName,
            temperature: 1,
            max_tokens: 2048,
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
        return response.data.choices[0].message.content;
    } catch (error) {
        if (isAxiosError(error)) {
            console.error(error.message);
        }
        console.error(error);
        return '';
    }
};

const getPersonalContext = async ({
    threadInfo,
    username,
}: {
    threadInfo: IChatLlmThread,
    username: string,
}) => {
    try {

        let promptUserInfo = '';

        // context -> user info
        if (threadInfo.isPersonalContextEnabled) {
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

            }
        }

        const currentDateTime = new Date().toLocaleString();
        promptUserInfo += `Current date and time: ${currentDateTime}. `;

        return `\n\n${promptUserInfo}\n\n`;
    } catch (error) {
        return '';
    }

}

const getTasks = async ({
    username,
    threadId,
}: {
    username: string,
    threadId: mongoose.Types.ObjectId,
}) => {
    let taskStr = '';

    const currentDate = new Date();
    const currentDateFromLast3Days = currentDate.getTime() - 24 * 60 * 60 * 1000 * 3;
    const currentDateFromLast3DaysDate = new Date(currentDateFromLast3Days);

    const currentDateFromLast15Days = currentDate.getTime() - 24 * 60 * 60 * 1000 * 15;
    const currentDateFromLast15DaysDate = new Date(currentDateFromLast15Days);

    const contextIds = [] as mongoose.Types.ObjectId[];

    const resultContexts = await ModelChatLlmThreadContextReference.aggregate([
        {
            $match: {
                username: username,
                referenceFrom: 'task',
                referenceId: { $ne: null },
                threadId: threadId,
            }
        }
    ]) as IChatLlmThreadContextReference[];

    for (let index = 0; index < resultContexts.length; index++) {
        const element = resultContexts[index];
        if (element.referenceId) {
            contextIds.push(element.referenceId);
        }
    }

    const resultTasks = await ModelTask.aggregate([
        {
            $match: {
                username: username,
                _id: {
                    $in: contextIds
                },
            }
        },
        {
            $lookup: {
                from: 'taskWorkspace',
                localField: 'taskWorkspaceId',
                foreignField: '_id',
                as: 'taskWorkspace',
            }
        },
        {
            $lookup: {
                from: 'taskStatusList',
                localField: 'taskStatusId',
                foreignField: '_id',
                as: 'taskStatusList',
            }
        },
        {
            $lookup: {
                from: 'taskComments',
                localField: '_id',
                foreignField: 'taskId',
                as: 'taskComments',
            }
        },
        {
            $lookup: {
                from: 'tasksSub',
                localField: '_id',
                foreignField: 'parentTaskId',
                as: 'tasksSub',
            }
        },
        {
            $addFields: {
                updatedAtUtcLast3DaysSortPoint: {
                    $cond: {
                        if: { $gte: ['$updatedAtUtc', currentDateFromLast3DaysDate] },
                        then: 50,
                        else: 5,
                    }
                },
                updatedAtUtcLast15DaysSortPoint: {
                    $cond: {
                        if: { $gte: ['$updatedAtUtc', currentDateFromLast15DaysDate] },
                        then: 25,
                        else: 5,
                    }
                },
                isCompletedSortPoint: {
                    $cond: {
                        if: { $eq: ['$isCompleted', true] },
                        then: -1000,
                        else: 5,
                    }
                },
                isArchivedSortPoint: {
                    $cond: {
                        if: { $eq: ['$isArchived', true] },
                        then: -1000,
                        else: 0,
                    }
                },
            }
        },
        {
            $addFields: {
                sortPoint: {
                    $add: [
                        '$updatedAtUtcLast3DaysSortPoint',
                        '$updatedAtUtcLast15DaysSortPoint',
                        '$isCompletedSortPoint',
                        '$isArchivedSortPoint',
                    ]
                }
            }
        },
        {
            $sort: {
                sortPoint: -1,
            }
        },
        {
            $limit: 25,
        }
    ]);

    if (resultTasks.length >= 1) {
        taskStr = 'Below are task list added by user.\n\n'
        for (let index = 0; index < resultTasks.length; index++) {
            const element = resultTasks[index];
            taskStr += `Task ${index + 1} -> title -> ${element.title}.\n`;
            taskStr += `Task ${index + 1} -> description -> ${element.description}.\n`;
            taskStr += `Task ${index + 1} -> priority -> ${element.priority}.\n`;
            taskStr += `Task ${index + 1} -> dueDate -> ${element.dueDate}.\n`;
            taskStr += `Task ${index + 1} -> isCompleted -> ${element.isCompleted ? 'Yes' : 'No'}.\n`;
            taskStr += `Task ${index + 1} -> isArchived -> ${element.isArchived ? 'Yes' : 'No'}.\n`;
            taskStr += `Task ${index + 1} -> labels -> ${element.labels.join(', ')}.\n`;

            if (element.taskWorkspace.length >= 1) {
                taskStr += `Task ${index + 1} -> workspace -> ${element.taskWorkspace[0].title}.\n`;
            }
            if (element.taskStatusList.length >= 1) {
                taskStr += `Task ${index + 1} -> status -> ${element.taskStatusList[0].statusTitle}.\n`;
            }

            if (element.taskComments.length >= 1) {
                taskStr += `Task ${index + 1} -> comments: \n`;
                for (let commentIndex = 0; commentIndex < element.taskComments.length; commentIndex++) {
                    const comment = element.taskComments[commentIndex];
                    taskStr += `Task ${index + 1} -> comments ${commentIndex + 1} -> ${comment.commentText} ${comment.isAi ? ' (AI)' : ''} \n`;
                }
            }

            if (element.tasksSub.length >= 1) {
                taskStr += `Task ${index + 1} -> subtasks: \n`;
                for (let subIndex = 0; subIndex < element.tasksSub.length; subIndex++) {
                    const subtask = element.tasksSub[subIndex];
                    taskStr += `Task ${index + 1} -> subtasks ${subIndex + 1} -> ${subtask.title} (${subtask.taskCompletedStatus ? 'completed' : 'pending'}) \n`;
                }
            }

            taskStr += '\n';
        }
        taskStr += '\n\n';
    }

    return taskStr;
}

const getNotes = async ({
    username,
    threadId,
}: {
    username: string,
    threadId: mongoose.Types.ObjectId,
}) => {
    let noteStr = '';

    const contextIds = [] as mongoose.Types.ObjectId[];

    const resultContexts = await ModelChatLlmThreadContextReference.aggregate([
        {
            $match: {
                username: username,
                referenceFrom: 'note',
                referenceId: { $ne: null },
                threadId: threadId,
            }
        }
    ]) as IChatLlmThreadContextReference[];

    for (let index = 0; index < resultContexts.length; index++) {
        const element = resultContexts[index];
        if (element.referenceId) {
            contextIds.push(element.referenceId);
        }
    }

    if (contextIds.length >= 1) {
        interface INotesAggregate extends INotes {
            notesWorkspaceArr: INotesWorkspace[];
        }

        const resultNotes = await ModelNotes.aggregate([
            {
                $match: {
                    username: username,
                    _id: {
                        $in: contextIds
                    },
                }
            },
            {
                $lookup: {
                    from: 'notesWorkspace',
                    localField: 'notesWorkspaceId',
                    foreignField: '_id',
                    as: 'notesWorkspaceArr',
                }
            }
        ]) as INotesAggregate[];
        if (resultNotes.length >= 1) {
            noteStr = 'Below are the notes added by the user:\n\n';
            for (let index = 0; index < resultNotes.length; index++) {
                const element = resultNotes[index];
                if (element.title.length >= 1) {
                    noteStr += `Note ${index + 1} -> title: ${element.title}.\n`;
                }
                if (element.description.length >= 1) {
                    const markdownContent = NodeHtmlMarkdown.translate(element.description);
                    noteStr += `Note ${index + 1} -> description: ${markdownContent}.\n`;
                }
                if (element.isStar) {
                    noteStr += `Note ${index + 1} -> isStar: Starred notes.\n`;
                }
                if (Array.isArray(element.tags) && element.tags.length > 0) {
                    noteStr += `Note ${index + 1} -> tags: ${element.tags.join(', ')}.\n`;
                }
                if (element.notesWorkspaceArr.length >= 1) {
                    noteStr += `Note ${index + 1} -> workspace: ${element.notesWorkspaceArr[0].title}.\n`;
                }

                noteStr += '\n';
            }
            noteStr += '\n\n';
        }
    }
    return noteStr;
}

const getNextMessageFromLast30Conversation = async ({
    // thread
    threadId,
    threadInfo,

    // auth
    username,

    // api key
    userApiKey,

    // model name
    aiModelProvider,
    aiModelName,
}: {
    threadId: mongoose.Types.ObjectId,
    threadInfo: IChatLlmThread,
    username: string;
    userApiKey: tsUserApiKey;

    // model name
    aiModelProvider: 'groq' | 'openrouter';
    aiModelName: string;
}) => {
    const messages = [];

    // system prompt
    const systemPrompt = threadInfo.systemPrompt || "";
    if (systemPrompt.length >= 1) {
        messages.push({
            "role": "system",
            "content": systemPrompt,
        })
    }

    // personal context
    const personalContext = await getPersonalContext({
        threadInfo,
        username,
    });
    messages.push({
        role: "user",
        content: personalContext,
    });

    // user info
    const userInfo = await ModelUser.findOne({ username }).exec();

    // tasks list
    const taskStr = await getTasks({
        username,
        threadId,
    });
    if (taskStr.length > 0) {
        messages.push({
            role: "user",
            content: taskStr,
        });
    }

    // notes list
    const noteStr = await getNotes({
        username,
        threadId,
    });
    if (noteStr.length > 0) {
        messages.push({
            role: "user",
            content: noteStr,
        });
    }

    // last 20 conversations
    const lastConversationsDesc = await getLast20Conversations({
        username,
        threadId,
    });
    const lastConversations = lastConversationsDesc.reverse();
    for (let index = 0; index < lastConversations.length; index++) {
        const element = lastConversations[index];

        if (element.content.includes("AI:")) {
            messages.push({
                role: "assistant",
                content: element.content.replace("AI:", "").trim(),
            });
        } else {
            messages.push({
                role: "user",
                content: element.content.replace('Text to audio:', ''),
            });
        }
    }

    // result
    let resultNextMessage = '';

    // llm auth token
    let llmAuthToken = '';

    // select preference model
    if (userInfo) {
        if (aiModelProvider === 'openrouter' && userApiKey.apiKeyOpenrouterValid) {
            llmAuthToken = userApiKey.apiKeyOpenrouter;
        } else if (aiModelProvider === 'groq' && userApiKey.apiKeyGroqValid) {
            llmAuthToken = userApiKey.apiKeyGroq;
        }
    }

    // fetch llm
    if (llmAuthToken.length >= 1) {
        if (aiModelProvider === 'groq') {
            resultNextMessage = await fetchLlm({
                argMessages: messages,
                modelName: aiModelName,

                provider: 'groq',
                llmAuthToken,
            });
        } else if (aiModelProvider === 'openrouter') {
            resultNextMessage = await fetchLlm({
                argMessages: messages,
                modelName: aiModelName,

                provider: 'openrouter',
                llmAuthToken,
            });
        }
    }

    // result
    return {
        nextMessage: resultNextMessage,
        aiModelProvider: aiModelProvider,
        aiModelName: aiModelName,
    };
}

export default getNextMessageFromLast30Conversation;