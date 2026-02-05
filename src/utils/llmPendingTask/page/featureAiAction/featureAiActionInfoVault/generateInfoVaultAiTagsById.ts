import { NodeHtmlMarkdown } from 'node-html-markdown';
import { ModelInfoVault } from "../../../../../schema/schemaInfoVault/SchemaInfoVault.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { IInfoVaultContact } from "../../../../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVault.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';


const  generateInfoVaultAiTagsById = async ({
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
            aiTags?: string[];
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

        let systemPrompt = `You are a JSON-based AI assistant specialized in extracting key topics and terms from contact information.
        Your task is to identify and generate a list of significant keywords based on the contact information provided by the user.
        These keywords should represent the main ideas, themes, or topics covered in the contact information.

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
                    updateObj.aiTags = parsed.keywords
                        .filter((tag: any) => typeof tag === 'string' && tag.trim().length > 0)
                        .map((tag: string) => tag.trim())
                        .sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()));
                }
            } catch (parseError) {
                console.error('Failed to parse AI tags response:', parseError);
            }
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

export default generateInfoVaultAiTagsById;

