import mongoose from "mongoose";
import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";
import { ModelTask } from "../../../../schema/schemaTask/SchemaTask.schema";
import { ModelChatLlm } from "../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { IChatLlm } from "../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { tsTaskList } from "../../../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types";
import { ModelChatLlmThreadContextReference } from "../../../../schema/schemaChatLlm/SchemaChatLlmThreadContextReference.schema";
import openrouterMarketing from "../../../../config/openrouterMarketing";

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
    response_format: {
        type: "json_object"
    };
    stop: null | string;
}

interface RelevantTasksResponse {
    relevantTasks: {
        taskId: string;
        relevanceScore: number;
        relevanceReason: string;
        priorityBonus?: number;
        urgencyBonus?: number;
    }[];
}

interface TaskSummary {
    id: string;
    title: string;
    description: string;
    priority: string;
    dueDate: Date | null;
    isCompleted: boolean;
    isArchived: boolean;
    labels: string[];
    labelsAi: string[];
    createdAt: Date;
    updatedAt: Date;
    daysSinceCreated: number;
    daysSinceUpdated: number;
    isOverdue: boolean;
    isDueSoon: boolean;
}

const getLast25ConversationsByThreadId = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId,
    username: string,
}) => {
    try {
        const resultChat = await ModelChatLlm.aggregate([
            {
                $match: {
                    username,
                    threadId,
                    type: "text",
                    // Exclude very old conversations to focus on recent context
                    createdAtUtc: {
                        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
                    }
                }
            },
            {
                $sort: {
                    createdAtUtc: -1,
                }
            },
            {
                $limit: 25,
            }
        ]) as IChatLlm[];

        return resultChat;
    } catch (error) {
        console.error(error);
        return [];
    }
}

const fetchLlmForTaskAnalysis = async ({
    argMessages,
    llmAuthToken,
    provider,
}: {
    argMessages: Message[];
    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}): Promise<string> => {
    try {
        let apiEndpoint = '';
        let modelName = '';
        if (provider === 'openrouter') {
            apiEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
            modelName = 'meta-llama/llama-3.2-11b-vision-instruct';
        } else if (provider === 'groq') {
            apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
            modelName = 'llama-3.1-8b-instant';
        }

        console.log('Task analysis - Message length: ', JSON.stringify(argMessages).length);
        console.log('Task analysis - Estimated tokens: ', Math.ceil(JSON.stringify(argMessages).length / 4));

        const data: RequestData = {
            messages: argMessages,
            model: modelName,
            temperature: 0.2, // Lower temperature for more focused analysis
            max_tokens: 4096,
            top_p: 0.9,
            stream: false,
            response_format: {
                type: "json_object"
            },
            stop: null,
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
            console.error('LLM API Error:', error.message);
            if (error.response?.data) {
                console.error('API Response:', error.response.data);
            }
        }
        console.log(error);
        return '';
    }
};

const prepareTaskSummary = (task: tsTaskList): TaskSummary => {
    const now = new Date();
    const createdAt = new Date(task.createdAtUtc);
    const updatedAt = new Date(task.updatedAtUtc);
    const daysSinceCreated = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const daysSinceUpdated = Math.floor((now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24));
    
    const isOverdue = task.dueDate ? new Date(task.dueDate) < now : false;
    const isDueSoon = task.dueDate ? 
        new Date(task.dueDate).getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000 && 
        new Date(task.dueDate).getTime() > now.getTime() : false;

    return {
        id: (task._id as mongoose.Types.ObjectId).toString(),
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: task.dueDate,
        isCompleted: task.isCompleted,
        isArchived: task.isArchived,
        labels: task.labels,
        labelsAi: task.labelsAi,
        createdAt,
        updatedAt,
        daysSinceCreated,
        daysSinceUpdated,
        isOverdue,
        isDueSoon,
    };
};

const getRelevantTasks = async ({
    username,
    threadId,
    conversationContext,
}: {
    username: string,
    threadId: mongoose.Types.ObjectId,
    conversationContext: string,
}): Promise<tsTaskList[]> => {
    try {
        const currentDate = new Date();
        const last60Days = new Date(currentDate.getTime() - 60 * 24 * 60 * 60 * 1000);
        const last30Days = new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        // Get tasks with intelligent filtering
        const resultTasks = await ModelTask.aggregate([
            {
                $match: {
                    username,
                    $and: [
                        // Task relevance criteria
                        {
                            $or: [
                                // Priority 1: Active tasks (not completed, not archived)
                                {
                                    isCompleted: false,
                                    isArchived: false
                                },
                                // Priority 2: Recently completed/archived tasks (last 30 days)
                                {
                                    $and: [
                                        {
                                            $or: [
                                                { isCompleted: true },
                                                { isArchived: true }
                                            ]
                                        },
                                        {
                                            updatedAtUtc: { $gte: last30Days }
                                        }
                                    ]
                                },
                                // Priority 3: Tasks with upcoming due dates (next 14 days)
                                {
                                    dueDate: {
                                        $gte: currentDate,
                                        $lte: new Date(currentDate.getTime() + 14 * 24 * 60 * 60 * 1000)
                                    }
                                },
                                // Priority 4: Overdue tasks (not completed/archived)
                                {
                                    dueDate: { $lt: currentDate },
                                    isCompleted: false,
                                    isArchived: false
                                }
                            ]
                        },
                        // Time-based filtering
                        {
                            $or: [
                                { createdAtUtc: { $gte: last60Days } },
                                { updatedAtUtc: { $gte: last60Days } },
                                { dueDate: { $gte: currentDate } }, // Future due dates
                                { 
                                    $and: [
                                        { dueDate: { $lt: currentDate } }, // Overdue
                                        { isCompleted: false },
                                        { isArchived: false }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            },
            {
                $addFields: {
                    // Calculate relevance score for initial filtering
                    relevanceScore: {
                        $add: [
                            // Priority scoring
                            {
                                $switch: {
                                    branches: [
                                        { case: { $eq: ['$priority', 'very-high'] }, then: 25 },
                                        { case: { $eq: ['$priority', 'high'] }, then: 20 },
                                        { case: { $eq: ['$priority', 'medium'] }, then: 15 },
                                        { case: { $eq: ['$priority', 'low'] }, then: 10 },
                                        { case: { $eq: ['$priority', 'very-low'] }, then: 5 },
                                    ],
                                    default: 0
                                }
                            },
                            // Due date urgency
                            {
                                $cond: {
                                    if: { $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', currentDate] }] },
                                    then: 30, // Overdue
                                    else: {
                                        $cond: {
                                            if: { $and: [{ $ne: ['$dueDate', null] }, { $lte: ['$dueDate', new Date(currentDate.getTime() + 3 * 24 * 60 * 60 * 1000)] }] },
                                            then: 20, // Due in 3 days
                                            else: {
                                                $cond: {
                                                    if: { $and: [{ $ne: ['$dueDate', null] }, { $lte: ['$dueDate', new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000)] }] },
                                                    then: 15, // Due in 7 days
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
                                    if: { $gte: ['$updatedAtUtc', new Date(currentDate.getTime() - 3 * 24 * 60 * 60 * 1000)] },
                                    then: 10, // Updated in last 3 days
                                    else: {
                                        $cond: {
                                            if: { $gte: ['$updatedAtUtc', new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000)] },
                                            then: 5, // Updated in last 7 days
                                            else: 0
                                        }
                                    }
                                }
                            },
                            // Completion penalty
                            {
                                $cond: {
                                    if: { $eq: ['$isCompleted', true] },
                                    then: -100,
                                    else: 0
                                }
                            },
                            // Archive penalty
                            {
                                $cond: {
                                    if: { $eq: ['$isArchived', true] },
                                    then: -500,
                                    else: 0
                                }
                            }
                        ]
                    }
                }
            },
            {
                $sort: {
                    relevanceScore: -1,
                    updatedAtUtc: -1
                }
            },
            {
                $limit: 50 // Get top 50 potentially relevant tasks
            }
        ]) as tsTaskList[];
        
        console.log(`Found ${resultTasks.length} potentially relevant tasks for analysis`);
        return resultTasks;
    } catch (error) {
        console.error('Error in getRelevantTasks:', error);
        return [];
    }
};

const getTop8RelevantTasks = ({
    validatedResponse,
    suggestedTasks,
}: {
    validatedResponse: RelevantTasksResponse;
    suggestedTasks: tsTaskList[];
}) => {
    try {
        // Combine task details with relevance info
        const result = validatedResponse.relevantTasks
            .map(suggestion => {
                const task = suggestedTasks.find(t => 
                    (t._id as mongoose.Types.ObjectId).toString() === suggestion.taskId
                );
                if (task) {
                    return {
                        task,
                        relevanceScore: suggestion.relevanceScore,
                        relevanceReason: suggestion.relevanceReason,
                        priorityBonus: suggestion.priorityBonus || 0,
                        urgencyBonus: suggestion.urgencyBonus || 0,
                    };
                }
                return null;
            })
            .filter(item => item !== null)
            .sort((a, b) => {
                // Sort by relevance score with bonuses
                const scoreA = a!.relevanceScore + a!.priorityBonus + a!.urgencyBonus;
                const scoreB = b!.relevanceScore + b!.priorityBonus + b!.urgencyBonus;
                return scoreB - scoreA;
            });

        // Return top 8 results
        return result.slice(0, 8);
    } catch (error) {
        console.error('Error in getTop8RelevantTasks:', error);
        return [];
    }
};

const insertTop8ContextReferences = async ({
    topResults,
    username,
    threadId,
}: {
    topResults: Array<{
        task: tsTaskList;
        relevanceScore: number;
        relevanceReason: string;
    }>;
    username: string;
    threadId: mongoose.Types.ObjectId;
}) => {
    try {
        if (topResults.length > 0) {
            // Remove old AI-generated task references to prevent buildup
            await ModelChatLlmThreadContextReference.deleteMany({
                threadId,
                username,
                referenceFrom: 'task',
                isAddedByAi: true,
                createdAtUtc: {
                    $lt: new Date(Date.now() - 10 * 60 * 1000) // Older than 10 minutes
                }
            });

            for (const item of topResults) {
                const existingReference = await ModelChatLlmThreadContextReference.findOne({
                    referenceFrom: 'task',
                    referenceId: item.task._id,
                    threadId,
                    username,
                });

                if (!existingReference) {
                    console.log('Inserting task reference: ', item.task._id, 'Score:', item.relevanceScore);
                    await ModelChatLlmThreadContextReference.create({
                        referenceFrom: 'task',
                        referenceId: item.task._id,
                        threadId,
                        username,
                        isAddedByAi: true,
                        createdAtUtc: new Date(),
                        updatedAtUtc: new Date(),
                    });
                }
            }
        }
        return true;
    } catch (error) {
        console.error('Error in insertTop8ContextReferences:', error);
        return false;
    }
};

const analyzeConversationWithLlm = async ({
    conversations,
    tasks,
    llmAuthToken,
    provider,
}: {
    conversations: IChatLlm[];
    tasks: tsTaskList[];
    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}): Promise<RelevantTasksResponse | null> => {
    try {
        const systemPrompt = `You are an AI assistant that analyzes conversation context and intelligently suggests relevant tasks. 

        Your task:
        1. Analyze the conversation context to understand the user's current focus, goals, and interests
        2. Review the available tasks and identify which ones are most relevant to the conversation
        3. Score each relevant task from 1-10 based on conversational relevance
        4. Provide a brief, specific reason for each suggestion
        5. Return only the top 8 most relevant tasks (minimum score of 6)

        RELEVANCE CRITERIA (prioritize in this order):
        1. TOPICAL RELEVANCE: Tasks directly related to conversation topics (score 7-10)
        2. CONTEXTUAL RELEVANCE: Tasks that support or relate to user's current focus (score 6-8)
        3. URGENCY: Overdue or due-soon tasks that need attention (score 7-9)
        4. PRIORITY: High-priority tasks that should be on user's radar (score 6-8)
        5. WORKFLOW RELEVANCE: Tasks that naturally follow from conversation topics (score 6-7)

        SCORING GUIDELINES:
        - Score 9-10: Directly mentioned or highly relevant to conversation
        - Score 7-8: Strongly related to conversation themes or urgent
        - Score 6-7: Moderately relevant or contextually important
        - Score 5 or below: Not relevant enough to include

        BONUS CONSIDERATIONS:
        - Add priorityBonus (1-5) for high-priority tasks
        - Add urgencyBonus (1-5) for overdue/due-soon tasks
        - Focus on incomplete, active tasks unless completed ones are conversation-relevant

        Return your response in this JSON format:
        {
        "relevantTasks": [
            {
            "taskId": "task_id_here",
            "relevanceScore": 8,
            "relevanceReason": "Specific reason why this task is relevant to the conversation",
            "priorityBonus": 2,
            "urgencyBonus": 3
            }
        ]
        }

        Only return tasks with relevance score >= 6. If no tasks meet this threshold, return an empty array.`;

        const conversationContext = conversations
            .map(conversation => {
                const cleanContent = conversation.content.replace(/^(AI:|Text to audio:)/, '').trim();
                return cleanContent;
            })
            .join('\n');

        const tasksSummary = tasks.map(task => prepareTaskSummary(task));

        let tasksStr = '';
        for (const task of tasksSummary) {
            tasksStr += `ID: ${task.id}\n`;
            tasksStr += `Title: ${task.title}\n`;
            tasksStr += `Description: ${task.description}\n`;
            tasksStr += `Priority: ${task.priority}\n`;
            tasksStr += `Due Date: ${task.dueDate ? task.dueDate.toLocaleDateString() : 'No due date'}\n`;
            tasksStr += `Status: ${task.isCompleted ? 'Completed' : 'Incomplete'}\n`;
            tasksStr += `Archived: ${task.isArchived ? 'Yes' : 'No'}\n`;
            tasksStr += `Labels: ${task.labels.join(', ')}\n`;
            tasksStr += `AI Labels: ${task.labelsAi.join(', ')}\n`;
            tasksStr += `Created: ${task.daysSinceCreated} days ago\n`;
            tasksStr += `Updated: ${task.daysSinceUpdated} days ago\n`;
            tasksStr += `Overdue: ${task.isOverdue ? 'Yes' : 'No'}\n`;
            tasksStr += `Due Soon: ${task.isDueSoon ? 'Yes' : 'No'}\n\n`;
        }

        const messages: Message[] = [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: `CONVERSATION CONTEXT:\n${conversationContext}\n\nAVAILABLE TASKS:\n${tasksStr}`
            }
        ];

        const llmResponse = await fetchLlmForTaskAnalysis({
            argMessages: messages,
            llmAuthToken,
            provider,
        });

        console.log('LLM Response for task analysis: ', llmResponse);

        // Parse LLM response with validation
        let parsedResponse: RelevantTasksResponse;
        try {
            parsedResponse = JSON.parse(llmResponse) as RelevantTasksResponse;
        } catch (parseError) {
            console.error('Failed to parse LLM response:', parseError);
            return null;
        }

        // Validate the parsed response structure
        if (!parsedResponse || typeof parsedResponse !== 'object') {
            console.error('Invalid response format: not an object');
            return null;
        }

        if (!parsedResponse.relevantTasks || !Array.isArray(parsedResponse.relevantTasks)) {
            console.error('Invalid response format: relevantTasks not found or not an array');
            return null;
        }

        // Validate each task in the response
        const validTasks = [];
        for (let index = 0; index < parsedResponse.relevantTasks.length; index++) {
            const taskItem = parsedResponse.relevantTasks[index];

            if (typeof taskItem === 'object' && taskItem !== null) {
                if (typeof taskItem.taskId === 'string' &&
                    typeof taskItem.relevanceScore === 'number' &&
                    typeof taskItem.relevanceReason === 'string' &&
                    taskItem.relevanceScore >= 6) {
                    validTasks.push(taskItem);
                }
            }
        }

        if (validTasks.length === 0) {
            console.log('No valid tasks found in LLM response with score >= 6');
            return null;
        }

        console.log(`Found ${validTasks.length} valid tasks with relevance score >= 6`);
        return { relevantTasks: validTasks };
    } catch (error) {
        console.error('Error in analyzeConversationWithLlm:', error);
        return null;
    }
};

const selectAutoContextTaskByThreadId = async ({
    threadId,
    username,
    llmAuthToken,
    provider,
}: {
    threadId: mongoose.Types.ObjectId,
    username: string,
    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}) => {
    try {
        console.log('Starting auto task selection for thread:', threadId);

        const last25Conversations = await getLast25ConversationsByThreadId({
            threadId,
            username,
        });

        if (last25Conversations.length === 0) {
            console.log('No conversations found for task selection');
            return false;
        }

        const last25ConversationsAsc = last25Conversations.reverse();
        const conversationContext = last25ConversationsAsc
            .map(conv => conv.content)
            .join('\n');

        console.log(`Analyzing ${last25ConversationsAsc.length} conversations for task relevance`);

        // Get relevant tasks with improved filtering
        const resultTasks = await getRelevantTasks({
            username,
            threadId,
            conversationContext,
        });
        
        if (resultTasks.length === 0) {
            console.log('No relevant tasks found');
            return false;
        }

        // Use LLM to analyze and select most relevant tasks
        const validatedResponse = await analyzeConversationWithLlm({
            conversations: last25ConversationsAsc,
            tasks: resultTasks,
            llmAuthToken,
            provider,
        });

        if (!validatedResponse) {
            console.log('No validated response from LLM');
            return false;
        }

        // Get full task details for the suggested tasks
        const suggestedTaskIds = validatedResponse.relevantTasks.map(item =>
            new mongoose.Types.ObjectId(item.taskId)
        );

        const suggestedTasks = await ModelTask.find({
            _id: { $in: suggestedTaskIds },
            username,
        });

        // Get top 8 relevant tasks
        const topResults = getTop8RelevantTasks({
            validatedResponse,
            suggestedTasks,
        });

        console.log(`Selected ${topResults.length} top relevant tasks`);

        // Insert top relevant tasks into context reference table
        const insertSuccess = await insertTop8ContextReferences({
            topResults,
            username,
            threadId,
        });

        if (!insertSuccess) {
            console.error('Failed to insert task context references');
            return false;
        }

        console.log('Auto task selection completed successfully');
        return true;
    } catch (error) {
        console.error('Error in selectAutoTaskNotesByThreadId:', error);
        return false;
    }
}

export default selectAutoContextTaskByThreadId;