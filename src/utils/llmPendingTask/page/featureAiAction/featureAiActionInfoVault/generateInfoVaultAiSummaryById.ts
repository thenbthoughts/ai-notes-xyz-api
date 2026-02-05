import { NodeHtmlMarkdown } from 'node-html-markdown';
import { ModelInfoVault } from "../../../../../schema/schemaInfoVault/SchemaInfoVault.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { IInfoVaultContact } from "../../../../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVault.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';


const  generateInfoVaultAiSummaryById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        const infoVaultRecords = await ModelInfoVault.find({
            _id: targetRecordId,
        }) as IInfoVaultContact[];

        if (!infoVaultRecords || infoVaultRecords.length !== 1) {
            return true;
        }

        const infoVaultFirst = infoVaultRecords[0];

        // Get LLM config using centralized function
        const llmConfig = await getDefaultLlmModel(infoVaultFirst.username);
        if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) {
            return true; // Skip if no LLM available
        }

        // Check if Info Vault AI feature is enabled for this user
        const user = await ModelUser.findOne({ username: infoVaultFirst.username });
        if (!user || !user.featureAiActionsInfoVault) {
            return true; // Skip if Info Vault AI is not enabled for this user
        }

        const updateObj = {
        } as {
            aiSummary?: string;
        };

        let argContent = `Name: ${infoVaultFirst.name}`;
        if(infoVaultFirst.nickname) {
            argContent += `Nickname: ${infoVaultFirst.nickname}\n`;
        }
        if(infoVaultFirst.company) {
            argContent += `Company: ${infoVaultFirst.company}\n`;
        }
        if(infoVaultFirst.jobTitle) {
            argContent += `Job Title: ${infoVaultFirst.jobTitle}\n`;
        }
        if(infoVaultFirst.notes && infoVaultFirst.notes.length >= 1) {
            const markdownContent = NodeHtmlMarkdown.translate(infoVaultFirst.notes);
            argContent += `Notes: ${markdownContent}\n`;
        }
        if(infoVaultFirst.tags.length >= 1) {
            argContent += `Tags: ${infoVaultFirst.tags.join(', ')}\n`;
        }
        if(infoVaultFirst.infoVaultType) {
            argContent += `Type: ${infoVaultFirst.infoVaultType}\n`;
        }
        if(infoVaultFirst.relationshipType) {
            argContent += `Relationship Type: ${infoVaultFirst.relationshipType}\n`;
        }

        let systemPrompt = `From the below content, generate a very detailed summary in simple language.
        Only output the summary, no other text. No markdown.
        Suggest out of the box ideas.
        Suggest few actions that can be taken.
        Suggestions for information management and networking.
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
            await ModelInfoVault.updateOne(
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

export default generateInfoVaultAiSummaryById;

