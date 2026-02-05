import { NodeHtmlMarkdown } from 'node-html-markdown';
import { ModelTask } from "../../../../../schema/schemaTask/SchemaTask.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { tsTaskList } from "../../../../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';


const  generateTaskAiTagsById = async ({
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
            labelsAi?: string[];
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

        let systemPrompt = `You are a JSON-based AI assistant specialized in extracting key topics and terms from task content.
        Your task is to identify and generate a list of significant keywords based on the task information provided by the user.
        These keywords should represent the main ideas, themes, or topics covered in the task.

        Output the result in JSON format as follows:
        {
            "keywords": ["keyword 1", "keyword 2", "keyword 3", ...]
        }

        Avoid generic words (e.g., 'the,' 'is,' 'and') and words with no specific relevance.
        Ensure that the keywords are concise and meaningful for quick reference.

        Respond only with the JSON structure.`;

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
            maxTokens: 512,
            topP: 1,
            responseFormat: "json_object",
        });

        if (llmResult.success && llmResult.content) {
            try {
                const parsed = JSON.parse(llmResult.content);
                if (parsed.keywords && Array.isArray(parsed.keywords)) {
                    updateObj.labelsAi = parsed.keywords
                        .filter((tag: any) => typeof tag === 'string' && tag.trim().length > 0)
                        .map((tag: string) => tag.trim())
                        .sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()));
                }
            } catch (parseError) {
                console.error('Failed to parse AI tags response:', parseError);
            }
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

export default generateTaskAiTagsById;

