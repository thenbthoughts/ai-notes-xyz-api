
import { getOllamaClient, ollamaDownloadModel } from "../../config/ollamaConfig";
import { v5 } from 'uuid';

const generateEmbedding = async ({
    apiKeyOllamaEndpoint,
    text,
}: {
    apiKeyOllamaEndpoint: string;
    text: string;
}): Promise<{
    success: string;
    error: string;
    data: {
        embedding: number[];
    }
}> => {
    try {
        console.log(`🧠 Generating embedding for: "${text.substring(0, 50)}..."`);

        const ollamaClient = await getOllamaClient({
            apiKeyOllamaEndpoint: apiKeyOllamaEndpoint,
        });

        if (!ollamaClient) {
            return {
                success: '',
                error: 'Error generating embedding',
                data: {
                    embedding: [],
                }
            }
        }

        const modelName = 'nomic-embed-text:latest';

        // download model if not exists
        const resultOllamaDownloadModel = await ollamaDownloadModel({
            apiKeyOllamaEndpoint: apiKeyOllamaEndpoint,
            modelName: modelName,
        });
        if(resultOllamaDownloadModel.error !== '') {
            return {
                success: '',
                error: resultOllamaDownloadModel.error,
                data: {
                    embedding: [],
                }
            }
        }

        // generate embedding
        const response = await ollamaClient.embeddings({
            model: modelName,
            prompt: text,
        });

        if (!response.embedding) {
            return {
                success: '',
                error: 'Error generating embedding',
                data: {
                    embedding: [],
                }
            }
        }

        console.log(`✅ Generated embedding with ${response.embedding.length} dimensions`);
        return {
            success: '',
            error: '',
            data: {
                embedding: response.embedding,
            }
        }
    } catch (error) {
        console.error('Error generating embedding:', error);
        return {
            success: '',
            error: 'Error generating embedding',
            data: {
                embedding: [],
            }
        }
    }
};

const generateUuidNamespaceDefaultDomain = () => {
    const DNS_NAMESPACE = v5.DNS;
    const uuid = v5('ai-notex.xyz', DNS_NAMESPACE);
    return uuid;
}

export { generateEmbedding, generateUuidNamespaceDefaultDomain };