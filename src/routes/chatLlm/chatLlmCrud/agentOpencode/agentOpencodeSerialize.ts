import type { IAgentOpencodeInstance } from '../../../../types/typesSchema/typesChatLlm/typesAgentOpencode/SchemaAgentOpencodeInstance.types';

export type AgentOpencodeInstanceSerialized = {
    id: string;
    status: IAgentOpencodeInstance['status'];
    statusIsRunning: boolean;
    pipelineStep: IAgentOpencodeInstance['pipelineStep'];
    promptText: string;
    errorReason: string;
    opencodeRunId: string;
    workspaceRootRelativePath: string;
    inputPromptRelativePath: string;
    outputPromptRelativePath: string;
    agentWorkspaceRelativePath: string;
    createdAtUtc: string;
    updatedAtUtc: string;
    filesInitializedAtUtc: string;
    isLatest: boolean;
    outputContent: string;
};

const iso = (value: Date | string | null | undefined): string => {
    if (!value) return '';
    try {
        return new Date(value).toISOString();
    } catch {
        return '';
    }
};

export const serializeAgentOpencodeInstance = (
    doc: IAgentOpencodeInstance | Record<string, unknown>,
    opts?: { isLatest?: boolean; outputContent?: string; promptLimit?: number }
): AgentOpencodeInstanceSerialized => {
    const rec = doc as Record<string, unknown>;
    const prompt = typeof rec.promptText === 'string' ? rec.promptText : '';
    const promptLimit = opts?.promptLimit;
    return {
        id: String(rec._id),
        status: (rec.status as AgentOpencodeInstanceSerialized['status']) || 'pending',
        statusIsRunning: Boolean(rec.statusIsRunning),
        pipelineStep: (rec.pipelineStep as AgentOpencodeInstanceSerialized['pipelineStep']) || '',
        promptText:
            typeof promptLimit === 'number' && prompt.length > promptLimit
                ? `${prompt.slice(0, promptLimit)}…`
                : prompt,
        errorReason: typeof rec.errorReason === 'string' ? rec.errorReason : '',
        opencodeRunId:
            typeof rec.opencodeRunId === 'string' && rec.opencodeRunId
                ? rec.opencodeRunId
                : typeof rec.cursorRunId === 'string'
                  ? rec.cursorRunId
                  : '',
        workspaceRootRelativePath:
            typeof rec.workspaceRootRelativePath === 'string' ? rec.workspaceRootRelativePath : '',
        inputPromptRelativePath:
            typeof rec.inputPromptRelativePath === 'string' ? rec.inputPromptRelativePath : '',
        outputPromptRelativePath:
            typeof rec.outputPromptRelativePath === 'string' ? rec.outputPromptRelativePath : '',
        agentWorkspaceRelativePath:
            typeof rec.agentWorkspaceRelativePath === 'string' ? rec.agentWorkspaceRelativePath : '',
        createdAtUtc: iso(rec.createdAtUtc as Date | string | null),
        updatedAtUtc: iso(rec.updatedAtUtc as Date | string | null),
        filesInitializedAtUtc: iso(rec.filesInitializedAtUtc as Date | string | null),
        isLatest: Boolean(opts?.isLatest),
        outputContent: opts?.outputContent || '',
    };
};
