import { DateTime } from 'luxon';
import { PipelineStage } from 'mongoose';

import { ModelTask } from "../../../../schema/schemaTask/SchemaTask.schema";
import { ModelTaskSchedule } from '../../../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import { ModelUser } from '../../../../schema/schemaUser/SchemaUser.schema';
import { ModelUserApiKey } from "../../../../schema/schemaUser/SchemaUserApiKey.schema";

import { tsTaskListSchedule } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';

import { funcSendMail } from '../../../files/funcSendMail';
import { getDefaultLlmModel } from '../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../utils/fetchLlmUnified';


const getTaskList = async ({
    auth_username,
}: {
    auth_username: string;
}) => {
    try {
        let tempStage = {} as PipelineStage;
        const stateDocument = [] as PipelineStage[];

        // auth
        tempStage = {
            $match: {
                username: auth_username,
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

        // limit -> 10
        tempStage = {
            $limit: 10,
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
                                        $eq: ['$username', auth_username]
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

        // pipeline
        const resultTasks = await ModelTask.aggregate(stateDocument);

        let taskStr = '';

        for (let index = 0; index < resultTasks.length; index++) {
            const element = resultTasks[index];
            taskStr += `----- \n`;
            taskStr += `🌟 Task #${index + 1}: ${element.title}\n`;
            if(element.description.length >= 1) {
                taskStr += `📝 Description: ${element.description}\n`;
            }
            taskStr += `🔥 Priority: ${element.priority}\n`;
            taskStr += `📅 Due Date: ${element.dueDate ? new Date(element.dueDate).toLocaleString() : 'No due date'}\n`;
            if(element.labels.length >= 1) {
                taskStr += `🏷️ Labels: ${element.labels.join(', ')}\n`;
            }
            if (element.taskWorkspace.length >= 1) {
                taskStr += `🗂️ Workspace: ${element.taskWorkspace[0].title}\n`;
            }
            if (element.taskStatusList.length >= 1) {
                taskStr += `🚦 Status: ${element.taskStatusList[0].statusTitle}\n`;
            }
            if (element.subTaskArr.length >= 1) {
                taskStr += `🔽 Subtasks:\n`;
                for (let subIndex = 0; subIndex < element.subTaskArr.length; subIndex++) {
                    const subtask = element.subTaskArr[subIndex];
                    taskStr += `   - [${subtask.taskCompletedStatus ? 'x' : ' '}] ${subtask.title}\n`;
                }
            }
            taskStr += `-----------------------------\n`;
            taskStr += '\n';
        }

        return taskStr;
    } catch (error) {
        console.error(error);
        return '';
    }
};

const sendAiGeneratedMail = async ({
    taskStr,
    username,
    smtpTo,
    dateStr,
}: {
    taskStr: string;
    username: string;
    smtpTo: string;
    dateStr: string;
}) => {
    try {
        // Get LLM config using centralized function
        const llmConfig = await getDefaultLlmModel(username);
        if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) {
            console.log('No LLM available for user, skipping AI-generated email');
            return false;
        }

        // Compose system prompt
        const systemPrompt = `
You are an AI email generator that creates motivational HTML email reports from task lists. Output only complete, standalone HTML—no explanations or code blocks.

Create a high-level overview with:
- Brief Summary: Concise overview highlighting main themes and priorities
- Strategic Advice: Encourage picking one task, breaking down overwhelming tasks into smaller steps, focusing on one at a time
- Brief Summary per Task: Plain language explanation of each task
- Motivation: Short encouraging reason why completing the task matters
- Next Step: Smallest possible action for immediate progress

Tone: Clear, supportive, playful, action-oriented.

Format: Valid, responsive HTML with inline CSS, mobile-friendly.

UI Requirements:
- Max width 600px, centered
- Dark gradient background (#1a1a2e to #16213e) with white text (#ffffff)
- High contrast: white text on dark backgrounds, dark text (#000000) on light backgrounds
- Task cards: white background (#ffffff), rounded corners (12px), shadow (0 6px 25px rgba(0,0,0,0.2))
- Fonts: 'Inter', 'Segoe UI', sans-serif
- H1 (28px, bold, white), H2 (24px, bold, black), H3 (20px, bold, black)
- Priority badges with proper contrast: High (#ff0066, white text), Medium (#ff6600, white text), Low (#00ff88, black text)
- Next Step badges: bright colors (#00ff88, #0099ff) with contrasting text

Structure:
1. H1 Main title with daily summary (white on dark)
2. H2 Strategic advice section (dark on light)
3. H2 Individual tasks as cards (dark on light)
4. H6 Footer (light on dark)

Output only HTML with inline CSS.
`;

        // Compose user prompt
        const userPrompt = `
Here is the raw task list for today (${dateStr}):
${taskStr}
`;

        // Use fetchLlmUnified with the config
        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider as 'openrouter' | 'groq' | 'ollama' | 'openai-compatible',
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.modelName,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.3,
            maxTokens: 8192,
            topP: 1,
            responseFormat: 'text',
        });

        if (!llmResult.success || !llmResult.content) {
            throw new Error("No valid HTML content returned from LLM.");
        }

        let html = llmResult.content.trim();
        console.log('html: ', html);

        // Fallback: If the LLM did not return a full HTML document, wrap it
        if (!/^<!DOCTYPE html>/i.test(html)) {
            html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>AI Daily Task Report</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; background: #f9f9f9; margin: 0; padding: 0;">
${html}
</body>
</html>
            `.trim();
        }

        // Send the email
        const subject = `Your AI-Generated Daily Task Report (${dateStr})`;
        const sendResult = await funcSendMail({
            username,
            smtpTo,
            subject,
            text: "Your daily task report is attached as an HTML email.",
            html
        });

        return sendResult;
    } catch (error) {
        console.error(error);
        return false;
    }
}

const suggestDailyTasksByAi = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // Step 1: Find and validate task record
        const taskInfo = await ModelTaskSchedule.findOne({
            _id: targetRecordId,
        }) as tsTaskListSchedule;
        if (!taskInfo) {
            return true;
        }
        
        // Step 2: Get task list by task schedule ID
        const taskStr = await getTaskList({
            auth_username: taskInfo.username,
        });

        if(taskStr === '') {
            return true;
        }

        // Step 3: validate api keys
        const apiKeys = await ModelUserApiKey.findOne({
            username: taskInfo.username,
            smtpValid: true,
        });
        if (!apiKeys) {
            return true;
        }

        // Step 4: get user email
        const userInfo = await ModelUser.findOne({
            username: taskInfo.username,
        });
        if (!userInfo) {
            return true;
        }

        // step 5.1: get current date
        // Use luxon to get the current date string in the user's timezone
        const currentDateInUserTz = DateTime.now().setZone(taskInfo.timezoneName);
        const dateStr = currentDateInUserTz.toFormat('yyyy-MM-dd');

        // Step 5.2: send mail
        await funcSendMail({
            username: taskInfo.username,
            smtpTo: userInfo.email,
            subject: `Daily Tasks Suggestion - ${dateStr}`,
            text: taskStr,
        });

        // step 5.3: send mail with ai generated html
        await sendAiGeneratedMail({
            taskStr,
            username: taskInfo.username,
            smtpTo: userInfo.email,
            dateStr,
        });

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default suggestDailyTasksByAi;