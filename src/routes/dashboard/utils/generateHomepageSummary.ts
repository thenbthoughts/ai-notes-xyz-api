import { ModelTask } from '../../../schema/schemaTask/SchemaTask.schema';
import { ModelUserMemory } from '../../../schema/schemaUser/SchemaUserMemory.schema';
import { ModelUser } from '../../../schema/schemaUser/SchemaUser.schema';
import { fetchLlmUnified, Message } from '../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getDefaultLlmModel } from '../../../utils/llmPendingTask/utils/getDefaultLlmModel';

const getUserInfoForSummary = async (username: string): Promise<string> => {
    try {
        if (!username) return '';

        let promptUserInfo = '';

        const userInfo = await ModelUser.findOne({ username }).exec();
        if (userInfo) {
            if (userInfo.name !== '') {
                promptUserInfo += `My name is ${userInfo.name}. `;
            }
            if (userInfo.city && userInfo.city.length > 0) {
                promptUserInfo += `I live in ${userInfo.city}. `;
            }
            if (userInfo.bio && userInfo.bio.length > 0) {
                promptUserInfo += `Bio: ${userInfo.bio}. `;
            }

            const currentDateTime = new Date().toLocaleString();
            promptUserInfo += `Current date and time: ${currentDateTime}. `;
        }
        return promptUserInfo;
    } catch (error) {
        console.error('Error in getUserInfoForSummary:', error);
        return '';
    }
}

const getUserMemoriesStr = async (username: string): Promise<string> => {
    try {
        // Get user to determine memory limit
        const user = await ModelUser.findOne({ username }).exec();
        const userMemoriesLimit = user?.userMemoriesLimit || 25;

        // Fetch memories up to the limit, sorted by most recently updated
        const memories = await ModelUserMemory.find({
            username: username,
        })
            .sort({ updatedAtUtc: -1 })
            .limit(userMemoriesLimit)
            .lean();

        if (!memories || memories.length === 0) {
            return '';
        }

        // Format memories as a string
        let memoryContext = '\n\nUser Memories (Important facts and information to remember):\n';
        memories.forEach((memory, index) => {
            memoryContext += `${index + 1}. ${memory.content}\n`;
        });
        memoryContext += '\n';

        return memoryContext;
    } catch (error) {
        console.error('Error in getUserMemoriesStr:', error);
        return '';
    }
}

const getTasksSummaryStr = async (username: string): Promise<string> => {
    const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
    try {
        let tempStage = {} as any;
        const stateDocument = [] as any[];

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

        // stateDocument -> add field
        const currentDate = new Date();
        tempStage = {
            $addFields: {
                // Calculate relevance score for initial filtering
                relevanceScore: {
                    $add: [
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
                                        else: 0
                                    }
                                }
                            }
                        },
                        // Recency bonus
                        {
                            $cond: {
                                if: { $gte: ['$updatedAtUtc', new Date(currentDate.getTime() - 7 * MILLISECONDS_PER_DAY)] },
                                then: 10, // Updated in last 7 days
                                else: 0
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

        // limit -> 20
        tempStage = {
            $limit: 20,
        }
        stateDocument.push(tempStage);

        // pipeline
        const resultTasks = await ModelTask.aggregate(stateDocument);

        if (resultTasks.length <= 0) {
            return '';
        }

        // create simplified task str
        let taskStr = `Current Tasks (${resultTasks.length}):\n`;
        const highPriorityTasks = resultTasks.filter(task => task.priority === 'very-high' || task.priority === 'high');
        const mediumPriorityTasks = resultTasks.filter(task => task.priority === 'medium');
        const otherTasks = resultTasks.filter(task => task.priority !== 'very-high' && task.priority !== 'high' && task.priority !== 'medium');

        if (highPriorityTasks.length > 0) {
            taskStr += `High Priority: ${highPriorityTasks.slice(0, 3).map(t => t.title).join(', ')}\n`;
        }
        if (mediumPriorityTasks.length > 0) {
            taskStr += `Medium Priority: ${mediumPriorityTasks.slice(0, 3).map(t => t.title).join(', ')}\n`;
        }
        if (otherTasks.length > 0 && highPriorityTasks.length === 0 && mediumPriorityTasks.length === 0) {
            taskStr += `Other: ${otherTasks.slice(0, 3).map(t => t.title).join(', ')}\n`;
        }

        return taskStr;
    } catch (error) {
        console.error('Error in getTasksSummaryStr:', error);
        return '';
    }
}


const generateHomepageSummary = async (username: string): Promise<string> => {
    try {
        // Get basic user info
        const userInfoStr = await getUserInfoForSummary(username);
        const tasksStr = await getTasksSummaryStr(username);
        const memoriesStr = await getUserMemoriesStr(username);

        // Combine the data
        let userDataString = '';

        if (userInfoStr.length > 0) {
            userDataString += `User Info: ${userInfoStr}\n\n`;
        }

        if (tasksStr.length > 0) {
            userDataString += `${tasksStr}\n`;
        }

        if (memoriesStr.length > 0) {
            userDataString += `${memoriesStr}`;
        }

        // If no data, return empty
        if (userDataString.trim().length === 0) {
            return '';
        }

        // System prompt for brief homepage summary generation with custom quote
        const systemPrompt = `
        You are a helpful AI assistant creating brief homepage summaries.

        Create a personalized summary in this exact format:

        [1-3 sentences summarizing the user's current status, activities, and priorities. Keep it brief, positive, and actionable.]

        "Create an original inspirational quote that relates specifically to this user's current situation and goals." — AI Wisdom

        Instructions:
        - Write 1-3 sentences for the summary
        - Create an original, personalized quote (not from famous people)
        - Make the quote encouraging and relevant to their current tasks/activities
        - Use "AI Wisdom" as the attribution
        - Do not use markdown formatting
        - Keep the entire response concise and motivating
        `;

        const userPrompt = `Analyze this user's current situation and create a personalized homepage summary:

User Information:
${userDataString}

Create a concise summary that captures their current activities, priorities, and progress. Follow this with an original inspirational quote that directly relates to their situation and motivates them forward.`;

        // Get LLM configuration using centralized function
        const llmConfig = await getDefaultLlmModel(username);
        if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) {
            return '';
        }

        console.log('llmConfig', llmConfig);

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

        // Call LLM to generate the brief summary
        const result = await fetchLlmUnified({
            provider: llmConfig.provider as 'groq' | 'openrouter' | 'ollama' | 'openai-compatible',
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.modelName,
            messages: messages,
            temperature: 1,
            maxTokens: 2048,
            stream: false,
            toolChoice: 'none',
        });

        console.log('result', result);

        if (!result.success) {
            console.error('Failed to generate homepage summary:', result.error);
            return '';
        }

        return result.content.trim();
    } catch (error) {
        console.error('Error in generateHomepageSummary:', error);
        return '';
    }
};

export {
    generateHomepageSummary,
};