import axios, {
    AxiosRequestConfig,
    AxiosResponse,
    isAxiosError,
} from "axios";

interface Message {
    role: string;
    content: string;
}

interface RequestData {
    messages: Message[];
    model: string;
    temperature: number;
    max_tokens: number;
    top_p: number;
    stream: boolean;
    stop: null | string;
}

const fetchLlmGroqTags = async ({
    argContent,

    llmAuthToken,
    provider,
}: {
    argContent: string,

    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}) => {
    try {
        // Validate input
        if (typeof argContent !== 'string' || argContent.trim() === '') {
            throw new Error('Invalid input: argContent must be a non-empty string.');
        }

        let apiEndpoint = '';
        let modelName = '';
        if(provider === 'openrouter') {
            apiEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
            modelName = 'meta-llama/llama-3.2-11b-vision-instruct';
        } else if(provider === 'groq') {
            apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
            modelName = 'meta-llama/llama-4-scout-17b-16e-instruct';
        }

        const data: RequestData = {
            messages: [
                {
                    role: "system",
                    content: "You are a JSON-based AI assistant specialized in extracting key topics and terms from user notes. Your task is to identify and generate a list of significant keywords based on the content provided by the user. These keywords should represent the main ideas, themes, or topics covered in the user's input. Output the result in JSON format as follows:\n\n{\n  \"keywords\": [\"keyword 1\", \"keyword 2\", \"keyword 3\", ...]\n}\n\nFocus on capturing nouns, significant verbs, and unique terms relevant to the content.\nAvoid generic words (e.g., 'the,' 'is,' 'and') and words with no specific relevance.\nEnsure that the keywords are concise and meaningful for quick reference.\n\nRespond only with the JSON structure.",
                },
                {
                    role: "user",
                    content: argContent,
                }
            ],
            model: modelName,
            temperature: 0,
            max_tokens: 1024,
            top_p: 1,
            stream: false,
            stop: null
        };

        const config: AxiosRequestConfig = {
            method: 'post',
            url: apiEndpoint,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${llmAuthToken}`,
            },
            data: JSON.stringify(data)
        };

        const response: AxiosResponse = await axios.request(config);
        const keywordsResponse = JSON.parse(response.data.choices[0].message.content);

        const finalTagsOutput = [] as string[];

        if (Array.isArray(keywordsResponse?.keywords)) {
            const keywords = keywordsResponse?.keywords;
            for (let index = 0; index < keywords.length; index++) {
                const element = keywords[index];
                if (typeof element === 'string') {
                    finalTagsOutput.push(element.trim());
                }
            }
        }

        console.log('finalTagsOutput: ', finalTagsOutput);

        return finalTagsOutput; // Return only the array of strings
    } catch (error: any) {
        console.error(error);
        if (isAxiosError(error)) {
            console.error(error.message);
        }
        console.error(error.response)
        return [];
    }
}

// Example usage
// const result = await fetchLlmGroq({
//     argContent: "Today learned 7 videos from Udemy."
// })

export default fetchLlmGroqTags;