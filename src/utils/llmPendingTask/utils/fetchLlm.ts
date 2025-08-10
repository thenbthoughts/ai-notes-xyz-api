import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from 'axios';
import openrouterMarketing from '../../../config/openrouterMarketing';

export type LlmProvider = 'openrouter' | 'groq' | 'openai' | 'ollama';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

export interface VisionContentPartText {
  type: 'text';
  text: string;
}

export interface VisionContentPartImageUrl {
  type: 'image_url';
  image_url: {
    url: string; // base64 or remote url
  };
}

export type MessageContent = string | Array<VisionContentPartText | VisionContentPartImageUrl>;

export interface Message {
  role: ChatRole;
  content: MessageContent;
}

export interface FetchLlmParams {
  provider: LlmProvider;
  // For OpenRouter/Groq/OpenAI this is the API key; for Ollama this is the base URL (e.g. http://localhost:11434)
  apiKeyOrEndpoint: string;
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  responseFormat?: 'json_object' | 'text';
  stream?: false; // streaming not implemented in this utility
  // Only for provider === 'openai' to override the base URL
  baseUrlOpenAiCompatible?: string;
  // Extra headers to merge into the request
  headersExtra?: Record<string, string>;
}

export interface FetchLlmResult {
  success: boolean;
  content: string; // best-effort normalized assistant text content
  raw: unknown; // full raw provider response for advanced uses
  error: string; // non-empty when success === false
}

/**
 * Normalize OpenAI-style chat completions payload
 */
function buildOpenAiPayload(params: FetchLlmParams) {
  const data: Record<string, unknown> = {
    messages: params.messages,
    model: params.model,
    temperature: params.temperature ?? 1,
    max_tokens: params.maxTokens ?? 2048,
    top_p: params.topP ?? 1,
    stream: false,
  };

  if (params.responseFormat === 'json_object') {
    data.response_format = { type: 'json_object' };
  } else if (params.responseFormat === 'text') {
    data.response_format = { type: 'text' };
  }

  return data;
}

/**
 * Extract string content from OpenAI-style responses
 */
function extractOpenAiContent(response: any): string {
  try {
    const choice = response?.choices?.[0];
    if (choice?.message?.content && typeof choice.message.content === 'string') {
      return choice.message.content;
    }
  } catch (_) {
    // no-op
  }
  return '';
}

/**
 * Convert OpenAI-style message parts to Ollama chat format
 */
function convertMessagesForOllama(messages: Message[]): Array<any> {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    // content as array (vision): merge text parts; collect images
    const textParts: string[] = [];
    const images: string[] = [];
    for (const part of msg.content) {
      if (part.type === 'text') {
        textParts.push(part.text);
      } else if (part.type === 'image_url' && part.image_url?.url) {
        images.push(part.image_url.url);
      }
    }
    const content = textParts.join('\n');
    const message: any = { role: msg.role, content };
    if (images.length > 0) {
      message.images = images;
    }
    return message;
  });
}

/**
 * Unified chat completion across providers: OpenRouter, Groq, OpenAI-compatible and Ollama.
 */
export async function fetchLlm(params: FetchLlmParams): Promise<FetchLlmResult> {
  try {

    // provider ollama
    if (params.provider === 'ollama') {
      // apiKeyOrEndpoint is the host URL for Ollama (e.g., http://localhost:11434)
      if (!params.apiKeyOrEndpoint) {
        return { success: false, content: '', raw: null, error: 'Ollama endpoint is required' };
      }

      const ollamaMessages = convertMessagesForOllama(params.messages);
      const url = `${params.apiKeyOrEndpoint.replace(/\/$/, '')}/api/chat`;
      const payload = {
        model: params.model,
        messages: ollamaMessages,
        stream: false,
        options: {
          temperature: params.temperature ?? 1,
          top_p: params.topP ?? 1,
        },
      };

      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
      });

      const content: string = response?.data?.message?.content ?? '';
      return { success: content.length > 0, content, raw: response.data, error: '' };
    }

    // OpenAI-compatible providers via REST like openrouter, groq, openai, etc.
    let apiEndpoint = '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (params.provider === 'openrouter') {
      apiEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
      headers['Authorization'] = `Bearer ${params.apiKeyOrEndpoint}`;
      Object.assign(headers, openrouterMarketing);
    } else if (params.provider === 'groq') {
      apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
      headers['Authorization'] = `Bearer ${params.apiKeyOrEndpoint}`;
    } else if (params.provider === 'openai') {
      apiEndpoint = params.baseUrlOpenAiCompatible || 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${params.apiKeyOrEndpoint}`;
    }

    if (params.headersExtra) {
      Object.assign(headers, params.headersExtra);
    }

    const data = buildOpenAiPayload(params);
    const config: AxiosRequestConfig = {
      method: 'post',
      url: apiEndpoint,
      headers,
      data: JSON.stringify(data),
    };

    const response: AxiosResponse = await axios.request(config);
    const content = extractOpenAiContent(response.data);
    return { success: content.length > 0, content, raw: response.data, error: '' };
  } catch (error) {
    if (isAxiosError(error)) {
      return { success: false, content: '', raw: error.response?.data, error: error.message };
    }
    return { success: false, content: '', raw: null, error: (error as Error)?.message || 'Unknown error' };
  }
}

/**
 * Convenience helper returning only assistant content string.
 */
export async function fetchLlmText(params: FetchLlmParams): Promise<string> {
  const result = await fetchLlm(params);
  return result.content;
}

export default fetchLlm;


