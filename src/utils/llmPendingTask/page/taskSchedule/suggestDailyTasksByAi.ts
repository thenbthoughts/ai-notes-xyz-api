import { DateTime } from 'luxon';
import { PipelineStage } from 'mongoose';
import axios from "axios";

import { ModelTask } from "../../../../schema/schemaTask/SchemaTask.schema";
import { ModelTaskSchedule } from '../../../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import { ModelUser } from '../../../../schema/SchemaUser.schema';
import { ModelUserApiKey } from "../../../../schema/SchemaUserApiKey.schema";

import { tsTaskListSchedule } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';

import { funcSendMail } from '../../../files/funcSendMail';


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
        // Get user's API keys for LLM
        const apiKeys = await ModelUserApiKey.findOne({
            username,
            $or: [
                { apiKeyGroqValid: true },
                { apiKeyOpenrouterValid: true }
            ]
        });
        if (!apiKeys) {
            throw new Error("No valid LLM API key found for user.");
        }

        let modelProvider: "groq" | "openrouter";
        let llmAuthToken: string;
        if (apiKeys.apiKeyOpenrouterValid) {
            modelProvider = "openrouter";
            llmAuthToken = apiKeys.apiKeyOpenrouter;
        } else if (apiKeys.apiKeyGroqValid) {
            modelProvider = "groq";
            llmAuthToken = apiKeys.apiKeyGroq;
        } else {
            throw new Error("No valid LLM API key found for user.");
        }

        // Compose system prompt
        const systemPrompt = `
You are an AI email generator specialized in turning raw task lists into a motivational HTML email report. Your output must be only the complete, standalone HTML email—do not include any explanations, introductions, or code blocks. Do not preface the HTML with any text such as "Here's a motivational HTML email report based on the provided task list:" or wrap it in markdown or code fences.

Your goal is to create a high-level overview with:

- Brief Summary: Explain each task in plain language so it's easy to understand.
- Motivation: Give a short, encouraging reason why completing this task matters.
- Next Step: Suggest the smallest possible next action to make immediate progress.

Tone: Clear, supportive, playful, and action-oriented.

Format: Output valid, responsive HTML styled in a modern, playful way with high contrast colors.

UI Requirements:
- The main content container must have a maximum width of 600px and be centered horizontally.
- Use a dark gradient background (e.g., linear-gradient from #1a1a2e to #16213e, or #0f0f23 to #16213e) for maximum contrast.
- Use high contrast, readable text colors: bright white (#ffffff) for headers, pure white (#ffffff) for body text on dark backgrounds, and dark navy (#0a0a0a) for text on light backgrounds.
- Add modern UI touches: rounded corners (8-12px), prominent drop shadows (0 4px 20px rgba(0,0,0,0.3)), and bold color accents.
- Each task block should be in a card with bright white background (#ffffff), rounded corners (12px), and strong shadow (0 6px 25px rgba(0,0,0,0.2)).
- Use proper heading hierarchy: H1 for main title, H2 for section headers, H3 for task titles.
- Highlight the "Next Step" label with a bright contrasting colored badge (e.g., #00ff88 bright green or #0099ff bright blue) with black text (#000000) and rounded corners.
- Use modern, clean fonts with proper font weights: 'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif.
- Make text bold for emphasis (**font-weight: 700**), use italics for motivational quotes.
- Include an introductory H1 section with bright white text (#ffffff) on the dark gradient background.
- Each task block must have: 
  * H3 task title (bold, color: #000000 on white background)
  * Metadata with high-contrast colored status badges (priority: #ff0066 bright red/#ff6600 bright orange/#ffcc00 bright yellow, status: #00ff88 bright green/#0099ff bright blue/#666666 dark gray)
  * Brief summary in regular weight (color: #000000)
  * Motivation in italic with a high-contrast background color (#f0f0f0 light gray with #000000 text)
  * Next step with prominent bright colored badge (#00ff88 or #0099ff) and bold black text (#000000)
- Footer should use H6 heading with medium contrast color (#cccccc) and smaller font on dark background.
- Add hover effects and transitions where appropriate.
- Use high-contrast color coding: High priority (#ff0066 bright red), Medium (#ff6600 bright orange), Low (#00ff88 bright green).
- Status colors: Completed (#00ff88 bright green), In Progress (#0099ff bright blue), Pending (#666666 dark gray).
- All content must be pure HTML with inline CSS, standalone and mobile-friendly (responsive).
- Make the UI feel modern, energetic, and visually engaging with maximum color contrast for accessibility.

High-Contrast Color Palette:
- Primary gradient: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)
- Accent colors: #0099ff (bright blue), #00ff88 (bright green), #ff0066 (bright red), #ff6600 (bright orange), #ffcc00 (bright yellow)
- Text: #000000 (on light backgrounds), #ffffff (on dark backgrounds), #cccccc (medium contrast on dark)
- Backgrounds: #ffffff (cards), #f0f0f0 (subtle light), #1a1a2e (dark main)

Typography Hierarchy with High Contrast:
- H1: 28px, font-weight: 700, color: #ffffff (on dark background)
- H2: 24px, font-weight: 600, color: #000000 (on light background)
- H3: 20px, font-weight: 600, color: #000000 (on light background)
- H4: 18px, font-weight: 500, color: #000000 (on light background)
- H5: 16px, font-weight: 500, color: #000000 (on light background)
- H6: 14px, font-weight: 400, color: #cccccc (on dark background)
- Body: 16px, font-weight: 400, color: #000000 (on light background)
- Bold emphasis: font-weight: 700
- Italic emphasis: font-style: italic, color: #000000

Example sections with high-contrast formatting:

<h3 style="color: #000000; font-weight: 600;">Sleep Hygiene Improvement</h3>
<div style="background: #f0f0f0; padding: 12px; border-radius: 6px; margin: 8px 0; color: #000000;">
  <strong>Brief:</strong> You want to improve sleep hygiene to get to bed earlier and feel more refreshed.
</div>
<div style="background: #e6f7ff; padding: 12px; border-radius: 6px; margin: 8px 0; border-left: 4px solid #0099ff; color: #000000;">
  <em><strong>Motivation:</strong> Better sleep means sharper focus, more energy, and a healthier mood.</em>
</div>
<div style="background: #00ff88; color: #000000; padding: 10px 16px; border-radius: 20px; display: inline-block; font-weight: 700; margin: 8px 0;">
  Next Step: Record your bedtime for the next 3 days to spot patterns.
</div>

The email should look professional but feel personal, modern, and visually striking with maximum contrast — like a premium productivity app sending tailored, encouraging advice with beautiful high-contrast design for optimal readability.

Again, your output must be only the HTML email with rich styling, proper headings, high-contrast colors, and modern UI elements, with no extra text or formatting.
`;

        // Compose user prompt
        const userPrompt = `
Here is the raw task list for today (${dateStr}):
${taskStr}
`;

        // Prepare LLM API call
        let apiEndpoint = "";
        let modelName = "";
        let headers: any = {};
        if (modelProvider === "openrouter") {
            apiEndpoint = "https://openrouter.ai/api/v1/chat/completions";
            modelName = "openai/gpt-oss-20b";
            headers = {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${llmAuthToken}`,
            };
        } else if (modelProvider === "groq") {
            apiEndpoint = "https://api.groq.com/openai/v1/chat/completions";
            modelName = "openai/gpt-oss-20b";
            headers = {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${llmAuthToken}`,
            };
        }

        const data = {
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            model: modelName,
            temperature: 0.3,
            max_tokens: 8192,
            top_p: 1,
            stream: false,
            response_format: { type: "text" },
            stop: null
        };

        // Call LLM
        const response = await axios.post(apiEndpoint, data, { headers });
        let html = "";
        if (
            response.data &&
            response.data.choices &&
            response.data.choices[0] &&
            response.data.choices[0].message &&
            typeof response.data.choices[0].message.content === "string"
        ) {
            html = response.data.choices[0].message.content.trim();
        } else {
            throw new Error("No valid HTML content returned from LLM.");
        }

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