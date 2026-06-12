import type { tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';

export function getAm4ShellUploadConfig(apiKey: tsUserApiKey): { baseUrl: string; token: string } | null {
    if (
        apiKey.apiKeyOpencodeWithShellValid &&
        apiKey.opencodeWithShellShellUrl?.trim() &&
        apiKey.opencodeWithShellShellToken
    ) {
        return {
            baseUrl: apiKey.opencodeWithShellShellUrl.replace(/\/+$/, ''),
            token: apiKey.opencodeWithShellShellToken,
        };
    }
    if (apiKey.shellEngineValid && apiKey.shellEngineUrl?.trim() && apiKey.shellEngineToken) {
        return {
            baseUrl: apiKey.shellEngineUrl.replace(/\/+$/, ''),
            token: apiKey.shellEngineToken,
        };
    }
    const envUrl = process.env.AM4_SHELL_ENGINE_URL?.trim();
    const envTok = process.env.AM4_SHELL_ENGINE_TOKEN?.trim();
    if (envUrl && envTok) {
        return { baseUrl: envUrl.replace(/\/+$/, ''), token: envTok };
    }
    return null;
}

export function getAm4OpencodeConfig(apiKey: tsUserApiKey): {
    baseUrl: string;
    userId: string;
    password: string;
} | null {
    if (apiKey.apiKeyOpencodeWithShellValid && apiKey.opencodeWithShellUrl?.trim()) {
        return {
            baseUrl: apiKey.opencodeWithShellUrl.replace(/\/+$/, ''),
            userId: apiKey.opencodeUsername?.trim() || 'opencode',
            password: apiKey.opencodePassword || '',
        };
    }
    return null;
}
