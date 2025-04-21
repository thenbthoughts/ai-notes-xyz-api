import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";
import envKeys from "../../../config/envKeys";
import openrouterMarketing from "../../../config/openrouterMarketing";

const fetchLlmGroqVision = async ({
    argContent,
    imageBase64,

    provider,
    llmAuthToken,
}: {
    argContent: string;
    imageBase64: string;

    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}) : Promise<string> => {
    try {
        let apiEndpoint = '';
        let modelName = '';
        if(provider === 'openrouter') {
            apiEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
            modelName = 'meta-llama/llama-3.2-11b-vision-instruct';
        } else if(provider === 'groq') {
            apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
            modelName = 'meta-llama/llama-4-scout-17b-16e-instruct';
        }

        const data = {
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: argContent
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: imageBase64
                            }
                        }
                    ]
                }
            ],
            model: modelName,
            temperature: 1,
            max_tokens: 4096,
            top_p: 1,
            stream: false,
            stop: null
        };

        const config: AxiosRequestConfig = {
            method: 'post',
            maxBodyLength: Infinity,
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
    } catch (error: any) {
        if(isAxiosError(error)) {
            console.error(error.message);
        }
        console.error(error);
        console.error(error?.response);
        return '';
    }
};

// Example usage
// const result = await fetchLlmGroqVision({
//     argContent: "Explain?",
//     imageUrl: "data:image/jpeg;base64,/abcd"
// })

export default fetchLlmGroqVision;