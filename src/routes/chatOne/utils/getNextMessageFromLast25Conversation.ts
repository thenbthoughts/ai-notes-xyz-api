import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";

import { ModelChatOne } from '../../../schema/SchemaChatOne.schema';
import envKeys from "../../../config/envKeys";
import { ModelUser } from '../../../schema/SchemaUser.schema';
import { ModelTask } from "../../../schema/SchemaTask.schema";
import { ModelMemo } from "../../../schema/SchemaMemoQuickAi.schema";
import { tsUserApiKey } from "../../../utils/llm/llmCommonFunc";

interface Message {
    role: string;
    content: string;
}

// Function to get the last 20 conversations from MongoDB
const getLast30Conversations = async ({
    username
}: {
    username: string
}): Promise<Message[]> => {
    const conversations = await ModelChatOne
        .find({
            username,
            type: "text"
        })
        .sort({ createdAtUtc: -1 })
        .limit(16)
        .exec();

    return conversations.map((convo: { content: string; }) => ({
        role: 'user',
        content: convo.content
    }));
}

// Function to get user info from the database
const getUserInfo = async (username: string) => {
    if (!username) return null;

    const user = await ModelUser.findOne({ username }).exec();
    return user;
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

const getNextMessageFromLast30Conversation = async ({
    username,

    userApiKey,
}: {
    username: string;

    userApiKey: tsUserApiKey;
}) => {
    const lastConversationsDesc = await getLast30Conversations({
        username
    });
    const lastConversations = lastConversationsDesc.reverse();

    const messages = [];

    let systemPrompt = "You are a helpful chatbot assistant. ";
    systemPrompt += "Your role is to provide concise, informative and engaging responses to user inquiries based on the context of previous conversations. "

    systemPrompt += "Memos and Tasks are included in the LLM context; use them to inform responses when only relevant. ";
    systemPrompt += "First respond with greeting then response with message. ";
    systemPrompt += "First, respond with a greeting, then you may response with an out-of-the-box idea.";

    messages.push({
        "role": "system",
        "content": systemPrompt,
    })

    const userInfo = await getUserInfo(username);

    // context -> user info
    if (userInfo) {
        let promptUserInfo = '';
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

        if (promptUserInfo.length > 0) {
            messages.push({
                role: "user",
                content: promptUserInfo,
            });
        }
    }

    // memo list
    const resultMemos = await ModelMemo.aggregate([
        {
            $match: {
                username: username
            }
        }
    ]);
    if (resultMemos.length >= 1) {
        let memoStr = 'Below are the memos added by the user:\n\n';
        for (let index = 0; index < resultMemos.length; index++) {
            const element = resultMemos[index];
            memoStr += `Memo ${index + 1} -> title: ${element.title}.\n`;
            memoStr += `Memo ${index + 1} -> content: ${element.content}.\n`;
            memoStr += '\n';
        }
        memoStr += '\n\n';
        messages.push({
            role: "user",
            content: memoStr,
        });
    }

    // tasks list
    const resultTasks = await ModelTask.aggregate([
        {
            $match: {
                username: username
            }
        }
    ]);
    if (resultTasks.length >= 1) {
        let taskStr = '';
        taskStr = 'Below are task list added by user.\n\n'
        for (let index = 0; index < resultTasks.length; index++) {
            const element = resultTasks[index];
            taskStr += `Task ${index + 1} -> title -> ${element.title}.\n`;
            taskStr += `Task ${index + 1} -> description -> ${element.description}.\n`;
            taskStr += `Task ${index + 1} -> status -> ${element.taskStatusCurrent}.\n`;
            taskStr += '\n';
        }
        taskStr += '\n\n';
        messages.push({
            role: "user",
            content: taskStr,
        });
    }

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
                content: element.content,
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