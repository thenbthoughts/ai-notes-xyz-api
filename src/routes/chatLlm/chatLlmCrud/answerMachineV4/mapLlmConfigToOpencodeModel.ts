import type { LlmConfig } from '../answerMachineShared/answerMachineGetLlmConfig';
import { AM4_OPENROUTER_AUTO_FALLBACK_MODEL_ID } from './am4OpencodeConstants';

/** Best-effort map from thread LLM config to OpenCode `model` selector shape. */
export function opencodeModelFromLlmConfig(
    llmConfig: LlmConfig
): { providerID: string; modelID: string } | undefined {
    const model = (llmConfig.model || '').trim();
    if (!model) {
        return undefined;
    }
    switch (llmConfig.provider) {
        case 'groq':
            return { providerID: 'groq', modelID: model };
        case 'openrouter': {
            const modelID = model === 'openrouter/auto' ? AM4_OPENROUTER_AUTO_FALLBACK_MODEL_ID : model;
            return { providerID: 'openrouter', modelID };
        }
        case 'ollama':
            return { providerID: 'ollama', modelID: model };
        case 'localai':
            return { providerID: 'openai', modelID: model };
        case 'openai-compatible':
        default:
            return { providerID: 'openai', modelID: model };
    }
}
