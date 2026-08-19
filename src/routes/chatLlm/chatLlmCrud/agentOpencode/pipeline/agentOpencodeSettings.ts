import openrouterMarketing from '../../../../../config/openrouterMarketing';
import type { tsUserApiKey } from '../../../../../utils/llm/llmCommonFunc';
import {
    agentOpencodeWriteFile,
    type AgentOpencodeShellConfig,
} from '../agentOpencodeWorkspace';
import type { AgentOpencodePipelinePaths } from './agentOpencodeStepInput';

export type AgentOpencodeProviderId =
    | 'groq'
    | 'openrouter'
    | 'openai'
    | 'ollama'
    | 'localai';

export type AgentOpencodeProviderRuntime = {
    id: AgentOpencodeProviderId;
    label: string;
    endpoint: string;
    apiKey: string;
    defaultModel: string;
    extraHeaders?: Record<string, string>;
};

const envQuote = (value: string): string => {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
    return `"${escaped}"`;
};

export const listConfiguredOpencodeLlmProviders = (
    apiKeys: tsUserApiKey
): AgentOpencodeProviderRuntime[] => {
    const out: AgentOpencodeProviderRuntime[] = [];

    if (apiKeys.apiKeyGroqValid && apiKeys.apiKeyGroq.trim()) {
        out.push({
            id: 'groq',
            label: 'Groq',
            endpoint: 'https://api.groq.com/openai/v1',
            apiKey: apiKeys.apiKeyGroq.trim(),
            defaultModel: 'openai/gpt-oss-20b',
        });
    }

    if (apiKeys.apiKeyOpenrouterValid && apiKeys.apiKeyOpenrouter.trim()) {
        out.push({
            id: 'openrouter',
            label: 'OpenRouter',
            endpoint: 'https://openrouter.ai/api/v1',
            apiKey: apiKeys.apiKeyOpenrouter.trim(),
            defaultModel: 'openai/gpt-oss-20b',
            extraHeaders: openrouterMarketing,
        });
    }

    if (apiKeys.apiKeyOpenaiValid && apiKeys.apiKeyOpenai.trim()) {
        out.push({
            id: 'openai',
            label: 'OpenAI',
            endpoint: 'https://api.openai.com/v1',
            apiKey: apiKeys.apiKeyOpenai.trim(),
            defaultModel: 'gpt-4o-mini',
        });
    }

    if (apiKeys.apiKeyOllamaValid && apiKeys.apiKeyOllamaEndpoint.trim()) {
        const host = apiKeys.apiKeyOllamaEndpoint.trim().replace(/\/+$/, '');
        out.push({
            id: 'ollama',
            label: 'Ollama',
            endpoint: `${host}/v1`,
            apiKey: '',
            defaultModel: 'llama3.2',
        });
    }

    if (apiKeys.apiKeyLocalaiValid && apiKeys.apiKeyLocalaiEndpoint.trim()) {
        const host = apiKeys.apiKeyLocalaiEndpoint.trim().replace(/\/+$/, '');
        out.push({
            id: 'localai',
            label: 'LocalAI',
            endpoint: `${host}/v1`,
            apiKey: apiKeys.apiKeyLocalai.trim(),
            defaultModel: 'gemma-3-1b-it',
        });
    }

    return out;
};

export const hasAgentOpencodeLlmProvider = (apiKeys: tsUserApiKey): boolean =>
    listConfiguredOpencodeLlmProviders(apiKeys).length > 0;

export const pickAgentOpencodeModel = (
    providers: AgentOpencodeProviderRuntime[]
): { providerID: string; modelID: string; cliModel: string } => {
    const preferred =
        providers.find((p) => p.id === 'openrouter') ||
        providers.find((p) => p.id === 'groq') ||
        providers.find((p) => p.id === 'openai') ||
        providers[0];
    if (!preferred) {
        throw new Error(
            'No LLM API key is set. Add Groq, OpenRouter, OpenAI, Ollama, or LocalAI in Settings → API Keys.'
        );
    }
    return {
        providerID: preferred.id,
        modelID: preferred.defaultModel,
        cliModel: `${preferred.id}/${preferred.defaultModel.replace(new RegExp(`^${preferred.id}/`), '')}`,
    };
};

const openaiCompatibleProvider = (p: AgentOpencodeProviderRuntime): Record<string, unknown> => {
    const options: Record<string, unknown> = {
        baseURL: p.endpoint,
    };
    if (p.apiKey) {
        options.apiKey = p.apiKey;
    }
    if (p.extraHeaders) {
        options.headers = p.extraHeaders;
    }
    return {
        npm: '@ai-sdk/openai-compatible',
        name: p.label,
        options,
        models: {
            [p.defaultModel]: { name: p.defaultModel },
        },
    };
};

/** Groq / OpenRouter / OpenAI are built into OpenCode; skip the npm plugin so `opencode run --pure` works. */
const builtinProvider = (p: AgentOpencodeProviderRuntime): Record<string, unknown> => {
    const options: Record<string, unknown> = {};
    if (p.apiKey) {
        options.apiKey = p.apiKey;
    }
    if (p.extraHeaders) {
        options.headers = p.extraHeaders;
    }
    return {
        name: p.label,
        options,
        models: {
            [p.defaultModel]: {},
        },
    };
};

const providerConfig = (p: AgentOpencodeProviderRuntime): Record<string, unknown> => {
    if (p.id === 'ollama' || p.id === 'localai') {
        return openaiCompatibleProvider(p);
    }
    return builtinProvider(p);
};

export const buildAgentOpencodeConfig = (apiKeys: tsUserApiKey): Record<string, unknown> => {
    const providers = listConfiguredOpencodeLlmProviders(apiKeys);
    const model = pickAgentOpencodeModel(providers);
    const selected = providers.find((p) => p.id === model.providerID);
    const provider: Record<string, unknown> = {};
    // Only the chosen provider — extra endpoints (Ollama/LocalAI) can hang OpenCode startup.
    if (selected) {
        provider[selected.id] = providerConfig(selected);
    }
    return {
        $schema: 'https://opencode.ai/config.json',
        model: model.cliModel,
        permission: {
            '*': 'allow',
            bash: 'allow',
            edit: 'allow',
            write: 'allow',
            read: 'allow',
            glob: 'allow',
            grep: 'allow',
            webfetch: 'allow',
            question: 'deny',
        },
        provider,
    };
};

export const buildAgentOpencodeEnvFile = (apiKeys: tsUserApiKey): string => {
    const providers = listConfiguredOpencodeLlmProviders(apiKeys);
    const lines: string[] = [];
    const groq = providers.find((p) => p.id === 'groq');
    const openrouter = providers.find((p) => p.id === 'openrouter');
    const openai = providers.find((p) => p.id === 'openai');
    const ollama = providers.find((p) => p.id === 'ollama');
    const localai = providers.find((p) => p.id === 'localai');

    if (openrouter?.apiKey) {
        lines.push(`OPENROUTER_API_KEY=${envQuote(openrouter.apiKey)}`);
    }
    if (groq?.apiKey) {
        lines.push(`GROQ_API_KEY=${envQuote(groq.apiKey)}`);
    }
    if (openai?.apiKey) {
        lines.push(`OPENAI_API_KEY=${envQuote(openai.apiKey)}`);
    }
    if (ollama) {
        const host = apiKeys.apiKeyOllamaEndpoint.trim().replace(/\/+$/, '');
        lines.push(`OLLAMA_HOST=${envQuote(host)}`);
        lines.push(`OLLAMA_BASE_URL=${envQuote(host)}`);
    }
    if (localai) {
        lines.push(
            `LOCALAI_BASE_URL=${envQuote(apiKeys.apiKeyLocalaiEndpoint.trim().replace(/\/+$/, ''))}`
        );
        if (localai.apiKey) {
            lines.push(`LOCALAI_API_KEY=${envQuote(localai.apiKey)}`);
        }
    }
    if (apiKeys.apiKeyReplicateValid && apiKeys.apiKeyReplicate.trim()) {
        lines.push(`REPLICATE_API_TOKEN=${envQuote(apiKeys.apiKeyReplicate.trim())}`);
    }
    if (apiKeys.apiKeyRunpodValid && apiKeys.apiKeyRunpod.trim()) {
        lines.push(`RUNPOD_API_KEY=${envQuote(apiKeys.apiKeyRunpod.trim())}`);
    }
    return lines.length ? `${lines.join('\n')}\n` : '';
};

export const writeAgentOpencodeSettingsFiles = async ({
    shell,
    paths,
    apiKeys,
}: {
    shell: AgentOpencodeShellConfig;
    paths: AgentOpencodePipelinePaths;
    apiKeys: tsUserApiKey;
}): Promise<{ cliModel: string; providerNames: string[] }> => {
    const providers = listConfiguredOpencodeLlmProviders(apiKeys);
    if (providers.length < 1) {
        throw new Error(
            'No LLM API key is set. Add Groq, OpenRouter, OpenAI, Ollama, or LocalAI in Settings → API Keys.'
        );
    }
    const config = buildAgentOpencodeConfig(apiKeys);
    const configJson = `${JSON.stringify(config, null, 2)}\n`;
    const envBody = buildAgentOpencodeEnvFile(apiKeys);
    const model = pickAgentOpencodeModel(providers);

    await agentOpencodeWriteFile({
        shell,
        relativePath: `${paths.agentWorkspaceDir}/opencode.json`,
        buffer: Buffer.from(configJson, 'utf8'),
        mimeType: 'application/json',
    });
    if (envBody) {
        await agentOpencodeWriteFile({
            shell,
            relativePath: `${paths.agentWorkspaceDir}/.env`,
            buffer: Buffer.from(envBody, 'utf8'),
            mimeType: 'text/plain',
        });
    }

    return {
        cliModel: model.cliModel,
        providerNames: providers.map((p) => p.label),
    };
};
