import { NodeHtmlMarkdown } from 'node-html-markdown';
import { ModelTask } from "../../../../../schema/schemaTask/SchemaTask.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { tsTaskList } from "../../../../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';


const  generateTaskAiSummaryById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        const taskRecords = await ModelTask.find({
            _id: targetRecordId,
        }) as tsTaskList[];

        if (!taskRecords || taskRecords.length !== 1) {
            return true;
        }

        const taskFirst = taskRecords[0];

        // Get LLM config using centralized function
        const llmConfig = await getDefaultLlmModel(taskFirst.username);
        if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) {
            return true; // Skip if no LLM available
        }

        // Check if Task AI feature is enabled for this user
        const user = await ModelUser.findOne({ username: taskFirst.username });
        if (!user || !user.featureAiActionsTask) {
            return true; // Skip if Task AI is not enabled for this user
        }

        const updateObj = {
        } as {
            aiSummary?: string;
        };

        let argContent = `Title: ${taskFirst.title}`;
        if(taskFirst.description && taskFirst.description.length >= 1) {
            const markdownContent = NodeHtmlMarkdown.translate(taskFirst.description);
            argContent += `Description: ${markdownContent}\n`;
        }
        if(taskFirst.priority) {
            argContent += `Priority: ${taskFirst.priority}\n`;
        }
        if(taskFirst.dueDate) {
            argContent += `Due Date: ${taskFirst.dueDate}\n`;
        }
        if(taskFirst.labels.length >= 1) {
            argContent += `Labels: ${taskFirst.labels.join(', ')}\n`;
        }
        if(taskFirst.isCompleted) {
            argContent += `Status: Completed\n`;
        } else {
            argContent += `Status: Pending\n`;
        }

        let systemPrompt = `From the below content, generate a very detailed summary in simple language.
        Only output the summary, no other text. No markdown.
        Suggest out of the box ideas.
        Suggest few actions that can be taken.
        Suggestions for task management and productivity.
        Suggest few thoughtful questions that can be asked to the user to gather more information, uncover hidden needs, or improve the contents relevance and impact.`;

        // Use fetchLlmUnified with the config
        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider as 'openrouter' | 'groq' | 'ollama' | 'openai-compatible',
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.modelName,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: argContent },
            ],
            temperature: 0,
            maxTokens: 1024,
            topP: 1,
            responseFormat: 'text',
        });

        if (llmResult.success && llmResult.content && llmResult.content.length >= 1) {
            updateObj.aiSummary = llmResult.content;
        }

        if (Object.keys(updateObj).length >= 1) {
            await ModelTask.updateOne(
                { _id: targetRecordId },
                {
                    $set: {
                        ...updateObj,
                    },
                }
            );
        }

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default generateTaskAiSummaryById;

