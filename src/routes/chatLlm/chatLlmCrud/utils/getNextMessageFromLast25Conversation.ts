import mongoose from "mongoose";
import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelUser } from '../../../../schema/SchemaUser.schema';
import { ModelTask } from "../../../../schema/schemaTask/SchemaTask.schema";
import { ModelMemo } from "../../../../schema/SchemaMemoQuickAi.schema";
import { tsUserApiKey } from "../../../../utils/llm/llmCommonFunc";
import openrouterMarketing from "../../../../config/openrouterMarketing";
import { IChatLlmThread } from "../../../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types";

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
        .limit(20)
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
        console.log(error);
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

const getMemos = async ({
    username,
}: {
    username: string,
}) => {
    let memoStr = '';
    const resultMemos = await ModelMemo.aggregate([
        {
            $match: {
                username: username
            }
        }
    ]);
    if (resultMemos.length >= 1) {
        memoStr = 'Below are the memos added by the user:\n\n';
        for (let index = 0; index < resultMemos.length; index++) {
            const element = resultMemos[index];
            memoStr += `Memo ${index + 1} -> title: ${element.title}.\n`;
            memoStr += `Memo ${index + 1} -> content: ${element.content}.\n`;
            memoStr += '\n';
        }
        memoStr += '\n\n';
    }
    return memoStr;
}

const getTasks = async ({
    username,
}: {
    username: string,
}) => {
    let taskStr = '';

    const currentDate = new Date();
    const currentDateFromLast3Days = currentDate.getTime() - 24 * 60 * 60 * 1000 * 3;
    const currentDateFromLast3DaysDate = new Date(currentDateFromLast3Days);

    const currentDateFromLast15Days = currentDate.getTime() - 24 * 60 * 60 * 1000 * 15;
    const currentDateFromLast15DaysDate = new Date(currentDateFromLast15Days);

    const resultTasks = await ModelTask.aggregate([
        {
            $match: {
                username: username,
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
            $addFields: {
                updatedAtUtcLast3DaysSortPoint: {
                    $cond: {
                        if: { $lt: ['$updatedAtUtc', currentDateFromLast3DaysDate] },
                        then: 10,
                        else: 0,
                    }
                },
                updatedAtUtcLast15DaysSortPoint: {
                    $cond: {
                        if: { $lt: ['$updatedAtUtc', currentDateFromLast15DaysDate] },
                        then: 5,
                        else: 0,
                    }
                },
                isCompletedSortPoint: {
                    $cond: {
                        if: { $eq: ['$isCompleted', true] },
                        then: -50,
                        else: 5,
                    }
                },
                isArchivedSortPoint: {
                    $cond: {
                        if: { $eq: ['$isArchived', true] },
                        then: 1,
                        else: -100,
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
            $limit: 15,
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
                console.log('element.taskStatusList', element.taskStatusList[0].statusTitle);
                taskStr += `Task ${index + 1} -> status -> ${element.taskStatusList[0].statusTitle}.\n`;
            }

            taskStr += '\n';
        }
        taskStr += '\n\n';
    }

    return taskStr;
}

const getNextMessageFromLast30Conversation = async ({
    // thread
    threadId,
    threadInfo,

    // auth
    username,

    // api key
    userApiKey,
}: {
    threadId: mongoose.Types.ObjectId,
    threadInfo: IChatLlmThread,
    username: string;
    userApiKey: tsUserApiKey;
}) => {
    const messages = [];

    let systemPrompt = "You are a helpful chatbot assistant. ";
    systemPrompt += "Your role is to provide concise, informative and engaging responses to user inquiries based on the context of previous conversations. "

    systemPrompt += "Memos and Tasks are included in the LLM context; use them to inform responses when only relevant. ";
    systemPrompt += "First respond with greeting then response with message. ";
    systemPrompt += "First, respond with a greeting, then you may response with an out-of-the-box idea.";

    const personalContext = await getPersonalContext({
        threadInfo,
        username,
    });
    systemPrompt += personalContext;

    messages.push({
        "role": "system",
        "content": systemPrompt,
    })

    const userInfo = await ModelUser.findOne({ username }).exec();

    // memo list
    if (threadInfo.isAutoAiContextSelectEnabled) {
        const memoStr = await getMemos({
            username,
        });
        if (memoStr.length > 0) {
            messages.push({
                role: "user",
                content: memoStr,
            });
        }
    }

    // tasks list
    if (threadInfo.isAutoAiContextSelectEnabled) {
        const taskStr = await getTasks({
            username,
        });
        console.log('taskStr', taskStr);
        if (taskStr.length > 0) {
            messages.push({
                role: "user",
                content: taskStr,
            });
        }
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

    let resultNextMessage = '';

    let preferredModelProvider = '';
    let preferredModelName = '';
    let llmAuthToken = '';

    // select preference model
    if (userInfo) {
        if (userInfo.preferredModelProvider === 'openrouter' && userApiKey.apiKeyOpenrouterValid) {
            preferredModelProvider = 'openrouter';
            llmAuthToken = userApiKey.apiKeyOpenrouter;
            if (userInfo.preferredModelName.length >= 1) {
                preferredModelName = userInfo.preferredModelName;
            } else {
                preferredModelName = 'openrouter/auto'
            }
        } else if (userInfo.preferredModelProvider === 'groq' && userApiKey.apiKeyGroqValid) {
            preferredModelProvider = 'groq';
            llmAuthToken = userApiKey.apiKeyGroq;
            if (userInfo.preferredModelName.length >= 1) {
                preferredModelName = userInfo.preferredModelName;
            } else {
                preferredModelName = 'meta-llama/llama-4-scout-17b-16e-instruct'
            }
        }
    }

    console.log('messages length: ', JSON.stringify(messages).length);

    if (preferredModelProvider === 'groq') {
        resultNextMessage = await fetchLlm({
            argMessages: messages,
            modelName: preferredModelName,

            provider: 'groq',
            llmAuthToken,
        });
    } else if (preferredModelProvider === 'openrouter') {
        resultNextMessage = await fetchLlm({
            argMessages: messages,
            modelName: preferredModelName,

            provider: 'openrouter',
            llmAuthToken,
        });
    }

    return {
        nextMessage: resultNextMessage,
        aiModelProvider: preferredModelProvider,
        aiModelName: preferredModelName,
    };
}

export default getNextMessageFromLast30Conversation;