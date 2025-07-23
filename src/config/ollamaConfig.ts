import { Ollama } from "ollama";

const getOllamaClient = async ({
    apiKeyOllamaEndpoint,
}: {
    apiKeyOllamaEndpoint: string;
}): Promise<Ollama | null> => {
    try {
        const ollamaClient = new Ollama({
            host: apiKeyOllamaEndpoint,
        });

        const resultOllama = await ollamaClient.list();
        console.log('resultOllama: ', resultOllama);

        if(resultOllama.models.length >= 1) {
            return ollamaClient;
        }

        // if no models, return null
        return null;
    } catch (error) {
        console.error('Error getting ollama config:', error);
        return null;
    }
};

const ollamaDownloadModel = async ({
    apiKeyOllamaEndpoint,
    modelName,
}: {
    apiKeyOllamaEndpoint: string;
    modelName: string;
}): Promise<{
    success: string;
    error: string;
}> => {
    try {
        const ollamaClient = await getOllamaClient({
            apiKeyOllamaEndpoint: apiKeyOllamaEndpoint,
        });

        if(!ollamaClient) {
            return {
                success: '',
                error: 'Ollama not configured',
            }
        }

        const resultOllama = await ollamaClient.pull({
            model: modelName,
        });

        console.log('resultOllama: ', resultOllama);

        return {
            success: '',
            error: '',
        }

    } catch (error) {
        console.error('Error downloading ollama model:', error);
        return {
            success: '',
            error: 'Ollama not configured',
        }
    }
};

export { getOllamaClient, ollamaDownloadModel };