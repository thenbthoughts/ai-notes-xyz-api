import axios from 'axios';

const config = {
  llm: {
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      endpoint: 'https://api.openai.com/v1/chat/completions',
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    },
  }
}

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

export interface LlmProviderConfig {
  name: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface FetchLlmParams {
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  responseFormat?: 'json_object' | 'text';
  stream?: false; // streaming not implemented in this utility
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

export interface FetchLlmResult {
  content: string; // best-effort normalized assistant text content
  model: string;
  provider: string;
  raw?: unknown; // full raw provider response for advanced uses
  // Tool/function calls (if any)
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export class FetchLlmUnifiedClass {
  constructor() {
  }

  async call(provider: LlmProviderConfig, params: FetchLlmParams): Promise<FetchLlmResult> {
    switch (provider.name) {
      case 'openai':
        return this.callOpenAI({ model: provider.model, params });
      case 'openrouter':
        return this.callOpenRouter({ model: provider.model, params });
      case 'groq':
        return this.callGroq({ model: provider.model, params });
      case 'ollama':
        return this.callOllama({ model: provider.model, params, baseUrl: provider.baseUrl });
      default:
        throw new Error(`Unknown provider: ${provider.name}`);
    }
  }

  private async callOpenAI({
    model,
    params,
  }: {
    model: string;
    params: FetchLlmParams;
  }): Promise<FetchLlmResult> {
    if (!config.llm.openai.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const data: Record<string, unknown> = {
      messages: params.messages,
      model: model,
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

    if (params.tools && params.tools.length > 0) {
      (data as any).tools = params.tools;
    }
    if (params.toolChoice) {
      (data as any).tool_choice = params.toolChoice;
    }

    if (params.openaiExtras) {
      const { reasoning, seed, logprobs } = params.openaiExtras;
      if (reasoning) (data as any).reasoning = reasoning;
      if (typeof seed === 'number') (data as any).seed = seed;
      if (typeof logprobs === 'number') (data as any).logprobs = logprobs;
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.llm.openai.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (params.headersExtra) {
      Object.assign(headers, params.headersExtra);
    }

    const response = await axios.post(
      config.llm.openai.endpoint,
      data,
      { headers }
    );

    const choice: any = response.data?.choices?.[0];
    const content: string = choice?.message?.content ?? '';
    const toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls;

    return {
      content,
      model: response.data.model,
      provider: 'openai',
      raw: response.data,
      toolCalls,
      usage: {
        promptTokens: response.data.usage?.prompt_tokens,
        completionTokens: response.data.usage?.completion_tokens,
        totalTokens: response.data.usage?.total_tokens,
      },
    };
  }

  private async callOpenRouter({
    model,
    params,
  }: {
    model: string;
    params: FetchLlmParams;
  }): Promise<FetchLlmResult> {
    if (!config.llm.openrouter.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const data: Record<string, unknown> = {
      messages: params.messages,
      model: model,
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

    if (params.tools && params.tools.length > 0) {
      (data as any).tools = params.tools;
    }
    if (params.toolChoice) {
      (data as any).tool_choice = params.toolChoice;
    }

    if (params.openRouterApi?.provider?.sort) {
      data.provider = {
        sort: params.openRouterApi.provider.sort
      };
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.llm.openrouter.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/answer-machine-3',
      'X-Title': 'Answer Machine 3',
    };

    if (params.openrouterExtras?.routerTags) {
      Object.assign(headers, params.openrouterExtras.routerTags);
    }

    if (params.headersExtra) {
      Object.assign(headers, params.headersExtra);
    }

    const response = await axios.post(
      config.llm.openrouter.endpoint,
      data,
      { headers }
    );

    const choice: any = response.data?.choices?.[0];
    const content: string = choice?.message?.content ?? '';
    const toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls;

    return {
      content,
      model: response.data.model,
      provider: 'openrouter',
      raw: response.data,
      toolCalls,
      usage: {
        promptTokens: response.data.usage?.prompt_tokens,
        completionTokens: response.data.usage?.completion_tokens,
        totalTokens: response.data.usage?.total_tokens,
      },
    };
  }

  private async callGroq({
    model,
    params,
  }: {
    model: string;
    params: FetchLlmParams;
  }): Promise<FetchLlmResult> {
    if (!config.llm.groq.apiKey) {
      throw new Error('Groq API key not configured');
    }

    const data: Record<string, unknown> = {
      messages: params.messages,
      model: model,
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

    if (params.tools && params.tools.length > 0) {
      (data as any).tools = params.tools;
    }
    if (params.toolChoice) {
      (data as any).tool_choice = params.toolChoice;
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.llm.groq.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (params.headersExtra) {
      Object.assign(headers, params.headersExtra);
    }

    const response = await axios.post(
      config.llm.groq.endpoint,
      data,
      { headers }
    );

    const choice: any = response.data?.choices?.[0];
    const content: string = choice?.message?.content ?? '';
    const toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls;

    return {
      content,
      model: response.data.model,
      provider: 'groq',
      raw: response.data,
      toolCalls,
      usage: {
        promptTokens: response.data.usage?.prompt_tokens,
        completionTokens: response.data.usage?.completion_tokens,
        totalTokens: response.data.usage?.total_tokens,
      },
    };
  }

  private convertMessagesForOllama(messages: Message[]): Array<any> {
    return messages.map((msg) => {
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }

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

  private async callOllama({
    model,
    params,
    baseUrl,
  }: {
    model: string;
    params: FetchLlmParams;
    baseUrl?: string;
  }): Promise<FetchLlmResult> {
    const ollamaBaseUrl = baseUrl || config.llm.ollama.baseUrl;

    try {
      const pullUrl = `${ollamaBaseUrl.replace(/\/$/, '')}/api/pull`;
      const pullPayload = {
        name: model,
        stream: false
      };

      console.log(`Attempting to pull model: ${model}`);
      await axios.post(pullUrl, pullPayload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 3000000,
      });
      console.log(`Successfully pulled model: ${model}`);
    } catch (pullError: any) {
      console.warn(`Failed to pull model ${model}:`, pullError.message);
    }

    const ollamaMessages = this.convertMessagesForOllama(params.messages);
    const url = `${ollamaBaseUrl.replace(/\/$/, '')}/api/chat`;
    const payload: Record<string, unknown> = {
      model: model,
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
      timeout: 1000000,
    });

    const content: string = response?.data?.message?.content ?? '';
    const toolCalls: ToolCall[] | undefined = response?.data?.message?.tool_calls;

    return {
      content,
      model: response.data.model || model,
      provider: 'ollama',
      raw: response.data,
      toolCalls,
    };
  }
}
