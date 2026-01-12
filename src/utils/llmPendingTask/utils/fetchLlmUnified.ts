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

export interface VisionContentPartAudioBase64 {
  type: 'input_audio';
  input_audio: {
    data: string; // base64 string without data URL prefix
    format: "wav" | "mp3" | "m4a" | "flac";
  };
}

export type MessageContent = string | Array<VisionContentPartText | VisionContentPartImageUrl | VisionContentPartAudioBase64>;
export interface Message {
  role: ChatRole;
  content: MessageContent;
  // Optional fields to support tool/function calling
  name?: string;
  tool_call_id?: string;
}

// Tool/function calling types (OpenAI-compatible schema)
export interface ToolFunctionDef {
  name: string;
  description?: string;
  parameters?: any; // JSON Schema Object; kept as any for provider flexibility
}

export interface ToolDef {
  type: 'function';
  function: ToolFunctionDef;
}

export interface ToolCall {
  id?: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface FetchLlmParams {
  provider: LlmProvider;
  // API key for authentication (empty string allowed for openrouter, groq, openai; not used for ollama)
  apiKey: string;
  // API endpoint URL (empty string allowed for openrouter, groq, openai; required for ollama)
  apiEndpoint: string;
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
  // Tool/function calling
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  // Provider-specific extras (hybrid approach)
  openaiExtras?: {
    reasoning?: { effort?: 'low' | 'medium' | 'high' };
    seed?: number;
    logprobs?: number;
  };
  openrouterExtras?: {
    routerTags?: Record<string, string>;
  };
  groqExtras?: Record<string, unknown>;
  ollamaExtras?: {
    options?: Record<string, unknown>;
  };
  openRouterApi?: {
    provider?: {
      sort?: 'price' | 'throughput'
    }
  }
}

export interface FetchLlmStreamParams {
  provider: LlmProvider;
  apiKey: string;
  apiEndpoint: string;
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  responseFormat?: 'text';
  headersExtra?: Record<string, string>;
  openrouterExtras?: {
    routerTags?: Record<string, string>;
  };
}

export interface FetchLlmResult {
  success: boolean;
  content: string; // best-effort normalized assistant text content
  raw: unknown; // full raw provider response for advanced uses
  error: string; // non-empty when success === false
  // Tool/function calls (if any)
  toolCalls?: ToolCall[];
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

  // Tool/function calling (OpenAI-compatible)
  if (params.tools && params.tools.length > 0) {
    (data as any).tools = params.tools;
  }
  if (params.toolChoice) {
    (data as any).tool_choice = params.toolChoice;
  }
  if (params.toolChoice === 'none') {
    (data as any).tool_choice = [];
  }

  // OpenAI extras pass-through (only when provider is 'openai')
  if (params.provider === 'openai' && params.openaiExtras) {
    const { reasoning, seed, logprobs } = params.openaiExtras;
    if (reasoning) (data as any).reasoning = reasoning;
    if (typeof seed === 'number') (data as any).seed = seed;
    if (typeof logprobs === 'number') (data as any).logprobs = logprobs;
  }

  if (params.provider === 'openrouter' && params.openRouterApi) {
    if (params?.openRouterApi?.provider) {
      if (params?.openRouterApi?.provider?.sort) {
        data.provider = {
          sort: params?.openRouterApi?.provider?.sort
        }
      }
    }
  }

  return data;
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
export async function fetchLlmUnified(params: FetchLlmParams): Promise<FetchLlmResult> {
  try {

    // provider ollama
    if (params.provider === 'ollama') {
      // apiEndpoint is required for Ollama (e.g., http://localhost:11434)
      if (!params.apiEndpoint) {
        return { success: false, content: '', raw: null, error: 'Ollama endpoint is required' };
      }

      // Try to pull the model if it doesn't exist
      try {
        const pullUrl = `${params.apiEndpoint.replace(/\/$/, '')}/api/pull`;
        const pullPayload = {
          name: params.model,
          stream: false
        };

        console.log(`Attempting to pull model: ${params.model}`);
        await axios.post(pullUrl, pullPayload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 3000000, // 50 minutes timeout for model pulling
        });
        console.log(`Successfully pulled model: ${params.model}`);
      } catch (pullError: any) {
        console.warn(`Failed to pull model ${params.model}:`, pullError.message);
        // Continue with the chat request anyway - the model might already exist
      }

      const ollamaMessages = convertMessagesForOllama(params.messages);
      const url = `${params.apiEndpoint.replace(/\/$/, '')}/api/chat`;
      const payload: Record<string, unknown> = {
        model: params.model,
        messages: ollamaMessages,
        stream: false,
        options: {
          temperature: params.temperature ?? 1,
          top_p: params.topP ?? 1,
          ...(params.ollamaExtras?.options || {}),
        },
      };
      if (params.tools && params.tools.length > 0) {
        (payload as any).tools = params.tools;
      }
      if (params.toolChoice) {
        (payload as any).tool_choice = params.toolChoice;
      }

      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 1000000, // 10 minutes timeout for model pulling
      });

      const content: string = response?.data?.message?.content ?? '';
      const toolCalls: ToolCall[] | undefined = response?.data?.message?.tool_calls;
      return { success: content.length > 0 || !!toolCalls?.length, content, raw: response.data, error: '', toolCalls };
    }

    // OpenAI-compatible providers via REST like openrouter, groq, openai, etc.
    let finalApiEndpoint = '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (params.provider === 'openrouter') {
      finalApiEndpoint = params.apiEndpoint || 'https://openrouter.ai/api/v1/chat/completions';
      if (params.apiKey) {
        headers['Authorization'] = `Bearer ${params.apiKey}`;
      }
      Object.assign(headers, openrouterMarketing);
      if (params.openrouterExtras?.routerTags) {
        Object.assign(headers, params.openrouterExtras.routerTags);
      }
    } else if (params.provider === 'groq') {
      finalApiEndpoint = params.apiEndpoint || 'https://api.groq.com/openai/v1/chat/completions';
      if (params.apiKey) {
        headers['Authorization'] = `Bearer ${params.apiKey}`;
      }
    } else if (params.provider === 'openai') {
      finalApiEndpoint = params.apiEndpoint || params.baseUrlOpenAiCompatible || 'https://api.openai.com/v1/chat/completions';
      if (params.apiKey) {
        headers['Authorization'] = `Bearer ${params.apiKey}`;
      }
    }

    if (params.headersExtra) {
      Object.assign(headers, params.headersExtra);
    }

    const data = buildOpenAiPayload(params);
    const config: AxiosRequestConfig = {
      method: 'post',
      url: finalApiEndpoint,
      headers,
      data: JSON.stringify(data),
    };

    const response: AxiosResponse = await axios.request(config);
    const choice: any = (response as any)?.data?.choices?.[0];
    const content: string = choice?.message?.content ?? '';
    const toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls;
    return { success: content.length > 0 || !!toolCalls?.length, content, raw: response.data, error: '', toolCalls };
  } catch (error) {
    console.error('Llm failed error: ', error);
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
  const result = await fetchLlmUnified(params);
  return result.content;
}

/**
 * Streaming LLM chat completion for Groq and OpenRouter providers
 */
export async function fetchLlmUnifiedStream(
  params: FetchLlmStreamParams,
  onToken: ({
    token,
    reasoningContent,
  }: {
    token: string;
    reasoningContent: string;
  }) => Promise<void>
): Promise<{
  success: boolean; error?: string; fullContent: string, reasoningContent: string;

  // stats
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costInUsd: number;
}> {
  let returnStatsObj = {
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costInUsd: 0
  }

  try {
    let finalApiEndpoint = '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (params.provider === 'openrouter') {
      finalApiEndpoint = params.apiEndpoint || 'https://openrouter.ai/api/v1/chat/completions';
      if (params.apiKey) {
        headers['Authorization'] = `Bearer ${params.apiKey}`;
      }
      Object.assign(headers, openrouterMarketing);
      if (params.openrouterExtras?.routerTags) {
        Object.assign(headers, params.openrouterExtras.routerTags);
      }
    } else if (params.provider === 'groq') {
      finalApiEndpoint = params.apiEndpoint || 'https://api.groq.com/openai/v1/chat/completions';
      if (params.apiKey) {
        headers['Authorization'] = `Bearer ${params.apiKey}`;
      }
    } else {
      return {
        success: false,
        error: 'Streaming only supported for groq and openrouter providers',
        fullContent: '',
        reasoningContent: '',
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        costInUsd: 0,
      }
    }

    if (params.headersExtra) {
      Object.assign(headers, params.headersExtra);
    }

    const data: Record<string, unknown> = {
      messages: params.messages,
      model: params.model,
      temperature: params.temperature ?? 1,
      max_tokens: params.maxTokens ?? 2048,
      top_p: params.topP ?? 1,
      stream: true,
    };

    const config: AxiosRequestConfig = {
      method: 'post',
      url: finalApiEndpoint,
      headers,
      data: JSON.stringify(data),
      responseType: 'stream',
    };

    let fullContent = '';
    let reasoningContent = '';
    const response = await axios.request(config);

    // Check for HTTP errors
    if (response.status !== 200) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        fullContent: '',
        reasoningContent: '',
        ...returnStatsObj,
      };
    }

    // Handle streaming response
    const stream = response.data;
    let buffer = '';

    return new Promise<{
      success: boolean;
      error?: string;
      fullContent: string;
      reasoningContent: string;

      // stats
      promptTokens: number;
      completionTokens: number;
      reasoningTokens: number;
      totalTokens: number;
      costInUsd: number;
    }>((resolve, reject) => {
      stream.on('data', async (chunk: Buffer) => {
        buffer += chunk.toString();

        // Process complete lines (SSE format: "data: {...}\n\n")
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine === '[DONE]') {
            continue;
          }

          // Parse SSE format: "data: {...}"
          if (trimmedLine.startsWith('data: ')) {
            try {
              const jsonStr = trimmedLine.substring(6); // Remove "data: " prefix
              const data = JSON.parse(jsonStr);

              // Extract content delta from choices
              const choice = data?.choices?.[0];
              if (choice?.delta?.reasoning) {
                reasoningContent += choice.delta.reasoning;

                // Call the onToken callback
                try {
                  await onToken({
                    token: '',
                    reasoningContent,
                  });
                } catch (tokenError) {
                  console.error('Error in onToken callback:', tokenError);
                }
              }
              if (choice?.delta?.content) {
                const token = choice.delta.content;
                fullContent += token;

                // Call the onToken callback
                try {
                  await onToken({
                    token,
                    reasoningContent,
                  });
                } catch (tokenError) {
                  console.error('Error in onToken callback:', tokenError);
                }
              }

              // update stats
              returnStatsObj.promptTokens = data?.usage?.prompt_tokens ?? 0;
              returnStatsObj.completionTokens = data?.usage?.completion_tokens ?? 0;
              returnStatsObj.reasoningTokens = data?.usage?.reasoning_tokens ?? 0;
              returnStatsObj.totalTokens = data?.usage?.total_tokens ?? 0;
              returnStatsObj.costInUsd = data?.usage?.cost ?? 0;
            } catch (parseError) {
              // Skip invalid JSON lines (e.g., empty data lines)
              console.warn('Failed to parse SSE line:', trimmedLine);
            }
          }
        }
      });

      stream.on('end', () => {
        // Process any remaining buffer
        if (buffer.trim()) {
          const trimmedLine = buffer.trim();
          if (trimmedLine.startsWith('data: ') && trimmedLine !== '[DONE]') {
            try {
              const jsonStr = trimmedLine.substring(6);
              const data = JSON.parse(jsonStr);
              const choice = data?.choices?.[0];
              if (choice?.delta?.content) {
                const token = choice.delta.content;
                fullContent += token;
              }
            } catch (parseError) {
              console.warn('Failed to parse remaining buffer:', trimmedLine);
            }
          }
        }

        resolve({
          success: true,
          fullContent,
          reasoningContent,
          ...returnStatsObj,
        });
      });

      stream.on('error', (error: Error) => {
        console.error('Stream error:', error);
        resolve({
          success: false,
          error: error.message,
          fullContent,
          reasoningContent,
          ...returnStatsObj,
        });
      });
    });
  } catch (error) {
    console.error('Llm stream failed error: ', error);
    if (isAxiosError(error)) {
      return {
        success: false,
        error: error.message,
        fullContent: '',
        reasoningContent: '',
        ...returnStatsObj,
      };
    }
    return {
      success: false,
      error: (error as Error)?.message || 'Unknown error',
      fullContent: '',
      reasoningContent: '',
      ...returnStatsObj,
    };
  }
}

export default fetchLlmUnified;


