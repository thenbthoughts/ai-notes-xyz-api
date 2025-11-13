import axios from 'axios';

const config = {
  embedding: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      defaultModel: 'text-embedding-3-small',
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      defaultModel: 'nomic-embed-text',
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultModel: 'openai/text-embedding-3-small',
    },
  }
}

export interface EmbeddingProvider {
  name: 'openai' | 'ollama' | 'openrouter';
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  provider: string;
  usage?: {
    promptTokens?: number;
    totalTokens?: number;
  };
}

export class FetchEmbeddingUnifiedClass {
  constructor() {
  }
  
  async call(provider: EmbeddingProvider, text: string): Promise<EmbeddingResponse> {
    switch (provider.name) {
      case 'openai':
        return this.callOpenAI({ model: provider.model, text });
      case 'ollama':
        return this.callOllama({ model: provider.model, text });
      case 'openrouter':
        return this.callOpenRouter({ model: provider.model, text });
      default:
        throw new Error(`Unknown provider: ${provider.name}`);
    }
  }

  private async callOpenAI({
    model,
    text,
  }: {
    model: string;
    text: string;
  }): Promise<EmbeddingResponse> {
    if (!config.embedding.openai.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        model: model || config.embedding.openai.defaultModel,
        input: text,
      },
      {
        headers: {
          'Authorization': `Bearer ${config.embedding.openai.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      embedding: response.data.data[0]?.embedding || [],
      model: response.data.model,
      provider: 'openai',
      usage: {
        promptTokens: response.data.usage?.prompt_tokens,
        totalTokens: response.data.usage?.total_tokens,
      },
    };
  }

  private async callOllama({
    model,
    text,
  }: {
    model: string;
    text: string;
  }): Promise<EmbeddingResponse> {
    const response = await axios.post(
      `${config.embedding.ollama.baseUrl}/api/embeddings`,
      {
        model: model || config.embedding.ollama.defaultModel,
        prompt: text,
      }
    );

    return {
      embedding: response.data.embedding || [],
      model: response.data.model || model,
      provider: 'ollama',
    };
  }

  private async callOpenRouter({
    model,
    text,
  }: {
    model: string;
    text: string;
  }): Promise<EmbeddingResponse> {
    if (!config.embedding.openrouter.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const response = await axios.post(
      'https://openrouter.ai/api/v1/embeddings',
      {
        model: model || config.embedding.openrouter.defaultModel,
        input: text,
      },
      {
        headers: {
          'Authorization': `Bearer ${config.embedding.openrouter.apiKey}`,
          'HTTP-Referer': 'https://github.com/answer-machine-3',
          'X-Title': 'Answer Machine 3',
        },
      }
    );

    return {
      embedding: response.data.data[0]?.embedding || [],
      model: response.data.model,
      provider: 'openrouter',
      usage: {
        promptTokens: response.data.usage?.prompt_tokens,
        totalTokens: response.data.usage?.total_tokens,
      },
    };
  }
}
