import mongoose from "mongoose";
import { NodeHtmlMarkdown } from "node-html-markdown";

import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelUser } from '../../../../schema/schemaUser/SchemaUser.schema';
import { ModelTask } from "../../../../schema/schemaTask/SchemaTask.schema";
import { ModelNotes } from "../../../../schema/schemaNotes/SchemaNotes.schema";
import {
    ModelChatLlmThreadContextReference
} from "../../../../schema/schemaChatLlm/SchemaChatLlmThreadContextReference.schema";

import { tsUserApiKey } from "../../../../utils/llm/llmCommonFunc";
import { fetchLlmUnified, Message } from "../../../../utils/llmPendingTask/utils/fetchLlmUnified";

import { INotes } from "../../../../types/typesSchema/typesSchemaNotes/SchemaNotes.types";
import { IChatLlmThread } from "../../../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types";
import { IChatLlmThreadContextReference } from "../../../../types/typesSchema/typesChatLlm/SchemaChatLlmThreadContextReference.types";
import { INotesWorkspace } from "../../../../types/typesSchema/typesSchemaNotes/SchemaNotesWorkspace.types";
import { IChatLlm } from "../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { getFileFromS3R2 } from "../../../../utils/files/s3R2GetFile";
import { ModelUserApiKey } from "../../../../schema/schemaUser/SchemaUserApiKey.schema";
import { ModelAiModelModality } from "../../../../schema/schemaDynamicData/SchemaAiModelModality.schema";
import updateLlmModalModalityById from "../../../../utils/llm/updateLlmModalModalityById";

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
        role: 'user' as 'user',
        content: convo.content
    }));
}

const funcDoesModalSupportImage = async ({
    modelProvider,
    modelName,
    username,
}: {
    modelProvider: 'groq' | 'openrouter';
    modelName: string;
    username: string;
}) => {
    let resultModelModality = await ModelAiModelModality.findOne({
        provider: modelProvider,
        modalIdString: modelName,
    });

    if (!resultModelModality) {
        return false;
    }

    if (resultModelModality.isInputModalityImage === 'pending') {
        await updateLlmModalModalityById({
            modalIdString: modelName,
            provider: modelProvider,
            username: username,
        });

        resultModelModality = await ModelAiModelModality.findOne({
            provider: modelProvider,
            modalIdString: modelName,
        });
    }

    return resultModelModality?.isInputModalityImage === 'true';
}

const getBase64File = async ({
    fileUrl,
    type,

    userApiKey,
}: {
    fileUrl: string;
    type: 'image';
    userApiKey: tsUserApiKey;
}) => {
    let base64File = '';
    try {
        if (type === 'image') {
            const resultImage = await getFileFromS3R2({
                fileName: fileUrl,
                userApiKey: userApiKey,
            })
            const resultImageContent = await resultImage?.Body?.transformToByteArray();
            const resultImageContentString = resultImageContent ? Buffer.from(resultImageContent).toString('base64') : '';
            base64File = `data:image/png;base64,${resultImageContentString}`;
        }
    } catch (error) {
        console.error(error);
    }
    return base64File;
}

const getConversationList = async ({
    username,
    threadId,

    modelProvider,
    modelName,
}: {
    username: string,
    threadId: mongoose.Types.ObjectId,
    modelProvider: 'groq' | 'openrouter',
    modelName: string,
}) => {
    interface IChatLlmTemp extends IChatLlm {
        temp_base64_file: string;
    }

    const userApiKey = await ModelUserApiKey.findOne({
        username,
    });
    if (!userApiKey) {
        return [];
    }

    let conversationList = [] as Message[];

    const resultConversations = await ModelChatLlm.find({
        username,
        threadId,
    }) as IChatLlmTemp[];

    let isContainImages = false;
    for (let index = 0; index < resultConversations.length; index++) {
        const element = resultConversations[index];
        if (element.type === 'image') {
            isContainImages = true;
        }
    }

    let doesModalSupportImage = false;
    if (isContainImages) {
        doesModalSupportImage = await funcDoesModalSupportImage({
            modelProvider: modelProvider,
            modelName: modelName,
            username: username,
        });
    }

    for (let index = 0; index < resultConversations.length; index++) {
        const element = resultConversations[index];
        if (element.type === 'image') {
            const base64File = await getBase64File({
                fileUrl: element.fileUrl,
                type: 'image',
                userApiKey: userApiKey,
            });
            element.temp_base64_file = base64File;
        } else {
            element.temp_base64_file = '';
        }
    }

    for (let index = 0; index < resultConversations.length; index++) {
        const element = resultConversations[index];
        if (element.type === 'image') {
            // insert image
            if (doesModalSupportImage) {
                conversationList.push({
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: element.temp_base64_file,
                            },
                        }
                    ],
                });
            } else {
                // insert file content ai
                if (element.fileContentAi.length >= 1) {
                    conversationList.push({
                        role: 'user',
                        content: `Image description: ${element.fileContentAi}`,
                    });
                }
            }
        } else if (element.type === 'text') {
            conversationList.push({
                role: 'user',
                content: element.content,
            });
        }
    }

    return conversationList;
}

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
    const messages: Message[] = [];

    // system prompt
    const systemPrompt = threadInfo.systemPrompt || "";
    if (systemPrompt.length >= 1) {
        messages.push({
            role: "system",
            content: systemPrompt,
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

    // conversation list
    const conversationList = await getConversationList({
        username,
        threadId,
        modelProvider: aiModelProvider,
        modelName: aiModelName,
    });
    for (let index = 0; index < conversationList.length; index++) {
        const element = conversationList[index];
        messages.push(element);
    }

    // result
    let resultNextMessage = '';

    // llm auth token and endpoint
    let llmAuthToken = '';
    let llmEndpoint = '';

    // select preference model and get API key
    if (userInfo) {
        if (aiModelProvider === 'openrouter' && userApiKey.apiKeyOpenrouterValid) {
            llmAuthToken = userApiKey.apiKeyOpenrouter;
            llmEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
        } else if (aiModelProvider === 'groq' && userApiKey.apiKeyGroqValid) {
            llmAuthToken = userApiKey.apiKeyGroq;
            llmEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
        }
    }

    console.log('messages', messages);

    // fetch llm using unified approach
    if (llmAuthToken.length >= 1) {
        const result = await fetchLlmUnified({
            provider: aiModelProvider,
            apiKey: llmAuthToken,
            apiEndpoint: llmEndpoint,
            model: aiModelName,
            messages: messages,
            temperature: 1,
            maxTokens: 8096,
        });

        if (result.success) {
            resultNextMessage = result.content;
        } else {
            console.error('LLM fetch failed:', result.error);
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