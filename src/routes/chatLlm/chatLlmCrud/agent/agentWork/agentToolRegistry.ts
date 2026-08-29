import mongoose from 'mongoose';
import path from 'path';
import { ModelChatLlm } from '../../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelChatLlmThread } from '../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { ModelAgentMemory } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentUpdate } from '../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelUserApiKey } from '../../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../../utils/llm/llmCommonFunc';
import { Message } from '../../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../../chatUtils/chatLlmGetLlmConfig';
import { AgentToolContext, AgentToolDefinition, AgentToolResult } from './agentToolTypes';
import { createImageToTextTool } from './agentToolImageToText';
import { createOmniparserTool } from '../agentUtils/omniparser/omniparserTool';
import { searchAgentDomain, searchAllAgentDomains, AgentDomainSearchSource } from '../agentUtils/agentDomainAccess';
import axios from 'axios';
import { agentTaskFilesDir, agentTaskFilePath, getAgentShellConfig, shellExecuteCommand, shellStdoutShowsDeliverable, shellWriteFile } from '../agentUtils/agentShell/agentShellWorkspace';
import {
    AGENT_SHELL_CONTEXT_FILE_LIMIT,
    formatAgentShellListingForContext,
    normalizeAgentShellListing,
} from '../agentUtils/agentShell/agentShellListing';
import { assertAgentShellSafe } from '../agentUtils/agentShell/agentShellSafety';
import writeAgentLog, { fetchLlmUnifiedLogged } from '../agentUtils/agentWriteLog';
import { buildAgentContextPack, withContextChatMessages } from '../agentUtils/agentContextWindow';
import {
    AGENT_SCRIPT_CONTINUE_MAX,
    looksLikeIncompleteScript,
    resolveAgentScriptMaxTokens,
    scaleScriptMaxTokensForTask,
    stripGeneratedCodeFences,
} from '../agentUtils/agentScriptMaxTokens';

const updateTypeToLogAction = (updateType: string, payload?: Record<string, unknown>): string => {
    if (updateType === 'tick') {
        const action = typeof payload?.action === 'string' ? payload.action : '';
        if (action === 'noop') return 'noop';
        return action ? 'llm_decision' : 'tick_end';
    }
    if (updateType === 'message') return 'message_posted';
    if (updateType === 'error') return 'agent_error';
    if (updateType === 'plan') return 'plan';
    if (updateType === 'plan_probe') return 'plan_probe';
    if (updateType === 'verify') return 'verify';
    if (updateType === 'synthesize') return 'synthesize';
    if (updateType === 'skills_loaded') return 'skills_loaded';
    if (updateType === 'workspace_list') return 'workspace_list';
    return updateType;
};

export const writeUpdate = async ({
    agentInstanceId,
    userId,
    threadId,
    updateType,
    message,
    payload,
    goalId,
    tickNumber,
    logLevel,
}: {
    agentInstanceId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    updateType: string;
    message: string;
    payload?: Record<string, unknown>;
    goalId?: mongoose.Types.ObjectId | null;
    tickNumber: number;
    logLevel?: 'info' | 'warn' | 'error' | 'debug';
}) => {
    await ModelAgentUpdate.create({
        agentInstanceId,
        userId,
        threadId,
        updateType,
        message,
        payload: payload || {},
        goalId: goalId || null,
        tickNumber,
        createdAtUtc: new Date(),
    });
    await writeAgentLog({
        agentInstanceId,
        userId,
        threadId,
        action: updateTypeToLogAction(updateType, payload),
        title: message.slice(0, 120),
        message,
        level: logLevel || (updateType === 'error' ? 'error' : 'info'),
        payload: { updateType, ...(payload || {}) },
        raw: payload || {},
        goalId: goalId || null,
        tickNumber,
    });
};

const isExecutableCode = (str: string, type: 'node' | 'python'): boolean => {
    if (!str || str.trim().length < 5) return false;
    const clean = str.trim();
    if (/^(I|This) (need|will|want|shall|am going|script|code) /i.test(clean)) return false;
    if (type === 'node') {
        return /\b(const|let|var|require|function|console|fs|path|process|exports|module)\b/.test(clean);
    } else {
        return /\b(import|from|def|class|print|with|open|sys|os|PIL|Image)\b/.test(clean);
    }
};

/** Prefer explicit args, then filename extension, then code heuristics. Never run .py with node. */
const resolveScriptType = (
    args: Record<string, unknown>,
    fileName: string,
    code: string,
): 'node' | 'python' => {
    const ext = path.extname(fileName || '').toLowerCase();
    if (ext === '.py') return 'python';
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.ts') return 'node';

    const explicit = typeof args.scriptType === 'string' ? args.scriptType.toLowerCase().trim() : '';
    if (explicit === 'python' || explicit === 'python3' || explicit === 'py') return 'python';
    if (explicit === 'node' || explicit === 'js' || explicit === 'javascript') return 'node';

    const action = typeof args.action === 'string' ? args.action.toLowerCase().trim() : '';
    if (action === 'python') return 'python';
    if (action === 'node') return 'node';

    const py = isExecutableCode(code, 'python');
    const js = isExecutableCode(code, 'node');
    if (py && !js) return 'python';
    if (js && !py) return 'node';
    if (py && js) {
        // Image/pillow work almost always Python
        if (/\b(PIL|pillow|Image\.open|cv2)\b/i.test(code)) return 'python';
    }
    return 'node';
};

const buildScriptExecCommand = (
    scriptType: 'node' | 'python',
    absDir: string,
    scriptFileName: string,
    absolutePath: string,
): string => {
    const dir = absDir.replace(/"/g, '');
    const abs = absolutePath.replace(/"/g, '');
    const file = scriptFileName.replace(/"/g, '');
    if (scriptType === 'python') {
        // Run with system python3. Do not create .agent_venv in the workspace
        // (hundreds of venv files hide real deliverables from listings).
        return (
            `if [ -d "${dir}" ]; then cd "${dir}" && python3 "./${file}" 2>&1; ` +
            `elif [ -f "${abs}" ]; then python3 "${abs}" 2>&1; ` +
            `else echo "Script not found: ${file} (dir=${dir})" >&2; exit 1; fi`
        );
    }
    // Prefer cwd = script dir (so relative uploads/ paths work); fall back to absolute file path.
    return (
        `if [ -d "${dir}" ]; then cd "${dir}" && node "./${file}" 2>&1; ` +
        `elif [ -f "${abs}" ]; then node "${abs}" 2>&1; ` +
        `else echo "Script not found: ${file} (dir=${dir})" >&2; exit 1; fi`
    );
};

const generateCodeViaLlm = async (
    ctx: AgentToolContext,
    promptText: string,
    scriptType: 'node' | 'python',
): Promise<string> => {
    const llmConfig = await getLlmConfig({ threadId: ctx.threadId });
    if (!llmConfig || !ctx.logCtx) {
        return scriptType === 'node'
            ? `console.log('Task: ${promptText.replace(/'/g, "\\'")}');`
            : `print('Task: ${promptText.replace(/'/g, "\\'")}')`;
    }

    const thread = await ModelChatLlmThread.findById(ctx.threadId)
        .select('agentScriptMaxTokens chatLlmMaxTokens')
        .lean();
    const maxTokens = scaleScriptMaxTokensForTask(
        `${promptText}\n${ctx.currentGoal.title}\n${ctx.currentGoal.description}`,
        resolveAgentScriptMaxTokens(thread)
    );

    const contextPack = ctx.logCtx
        ? await buildAgentContextPack({
              logCtx: ctx.logCtx,
              agentInstanceId: ctx.agentInstanceId,
              userId: ctx.userId,
              threadId: ctx.threadId,
          })
        : null;

    const langLabel = scriptType === 'node' ? 'Node.js' : 'Python 3';
    const systemContent = `You are an expert ${langLabel} developer. Write executable, complete, production-ready ${langLabel} code to fulfill the task. Do NOT include markdown text, explanations, or backticks. Return raw executable code ONLY. Save output files using Node.js 'fs' or Python 'open' if needed.
The output must be a complete file that parses and runs. Do not stop mid-function, mid-string, or mid-HTML.
${
    scriptType === 'python'
        ? `PYTHON RULES:
- Use python3 APIs only.
- For pip installs use: import subprocess,sys; subprocess.check_call([sys.executable,'-m','pip','install','--break-system-packages','PKG'])
  or create/use a venv (.agent_venv) — never assume bare 'pip install' works (PEP 668).
- For Excel .xlsx prefer openpyxl only (do NOT use pandas). openpyxl is often already installed — try \`import openpyxl\` before any pip install. Never substitute .csv when .xlsx was requested.
- Prefer stdlib when possible (csv, json, html.parser, re, pathlib). Parse local HTML with html.parser — do not pip-install beautifulsoup4/lxml for that.
- Do not call bare \`pip install\` / \`os.system('pip ...')\` — use \`sys.executable -m pip install --break-system-packages\` only if import fails.`
        : `NODE RULES:
- Write the named deliverable file the task asked for. Do not leave the product only in create_artifact.js.
- Scripts must exit. Do not start a long-lived HTTP server unless the user asked for one.
- Never listen on ports 2000, 2001, 3000, 3010, or 3011. If a demo server is required, bind 127.0.0.1 on 18080+ or port 0, print the port, then exit.`
}`;

    const userContent = `Goal / Task: ${promptText}
Goal Title: ${ctx.currentGoal.title}
Goal Description: ${ctx.currentGoal.description}

CONTEXT (recent actions + summaries; no workspace dump):
${contextPack?.formatted || '(none — call list_workspace_files first if you need paths)'}

CRITICAL FILE PATH RULES:
- Do not assume a working directory or file listing. Use paths from recent list_workspace_files / tool results in CONTEXT.
- Use either an exact absolutePath from those results OR a pathInAgentFolder (e.g. 'uploads/filename.jpg').
- NEVER use full workspace prefix 'ai-notes-xyz-agent-workspace/shell/agent/...' as a relative path when running inside the agent folder!
- Do NOT invent placeholder filenames like 'input.jpg', 'image.png', or 'test.txt'.
- Save output files in the workspace root or uploads/ folder.`;

    const messages: Message[] = withContextChatMessages(
        { role: 'system', content: systemContent },
        contextPack?.chatWindow,
        { role: 'user', content: userContent }
    );

    const res = await fetchLlmUnifiedLogged({
        logCtx: ctx.logCtx,
        purpose: 'agent_script_code_gen',
        params: {
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.model,
            messages,
            temperature: 0.2,
            maxTokens,
            headersExtra: llmConfig.customHeaders,
        },
    });

    let rawCode = stripGeneratedCodeFences(res.content || '');
    let continuations = 0;
    while (
        looksLikeIncompleteScript(rawCode, scriptType) &&
        continuations < AGENT_SCRIPT_CONTINUE_MAX
    ) {
        continuations += 1;
        const continueRes = await fetchLlmUnifiedLogged({
            logCtx: ctx.logCtx,
            purpose: 'agent_script_code_gen_continue',
            params: {
                provider: llmConfig.provider,
                apiKey: llmConfig.apiKey,
                apiEndpoint: llmConfig.apiEndpoint,
                model: llmConfig.model,
                messages: [
                    {
                        role: 'system',
                        content:
                            `The previous ${langLabel} script was cut off by a token limit. ` +
                            `Output ONLY the remaining raw code to append so the file is complete. ` +
                            `Do not repeat existing lines. No markdown or explanations.`,
                    },
                    {
                        role: 'user',
                        content: `TASK:\n${promptText}\n\nEXISTING CODE (continue from the end):\n${rawCode.slice(-6000)}`,
                    },
                ],
                temperature: 0.1,
                maxTokens,
                headersExtra: llmConfig.customHeaders,
            },
        });
        const chunk = stripGeneratedCodeFences(continueRes.content || '');
        if (!chunk) break;
        if (
            /^(the script|this (code|script)|already complete|nothing to (add|append))/i.test(chunk) &&
            !/\b(const|let|var|function|def |import |from |class |print\(|console\.)/.test(chunk)
        ) {
            break;
        }
        rawCode = `${rawCode}\n${chunk}`;
    }

    return rawCode;
};

/**
 * Domain search helper tool implementation.
 */
const createDomainSearchTool = (source: AgentDomainSearchSource, toolName: string, description: string): AgentToolDefinition => ({
    name: toolName,
    description,
    execute: async (ctx, args) => {
        const query = typeof args.query === 'string' ? args.query : ctx.currentGoal.title;
        const hits = await searchAgentDomain({
            userId: ctx.userId,
            source,
            query,
            limit: 8,
        });

        const hitText = hits.length
            ? hits.map((h) => `- [${h.source}] ${h.title}: ${h.summary}`).join('\n')
            : 'No results.';

        const topSnippets = hits
            .slice(0, 3)
            .map((h) => `${h.title}: ${(h.summary || '').slice(0, 120)}`)
            .join(' | ');

        await ModelAgentMemory.create({
            agentInstanceId: ctx.agentInstanceId,
            userId: ctx.userId,
            threadId: ctx.threadId,
            key: `search_${source}_${ctx.tickNumber}`,
            content: `Query: ${query}\n${hitText}`.slice(0, 8000),
            memoryType: 'observation',
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });

        for (const h of hits.slice(0, 8)) {
            await ModelAgentMemory.create({
                agentInstanceId: ctx.agentInstanceId,
                userId: ctx.userId,
                threadId: ctx.threadId,
                key: `citation_${h.source}_${h.id}`.slice(0, 120),
                content: JSON.stringify({
                    source: h.source,
                    id: h.id,
                    title: h.title,
                    summary: (h.summary || '').slice(0, 400),
                }),
                memoryType: 'observation',
                createdAtUtc: new Date(),
                updatedAtUtc: new Date(),
            });
        }

        await writeUpdate({
            agentInstanceId: ctx.agentInstanceId,
            userId: ctx.userId,
            threadId: ctx.threadId,
            updateType: 'domain_search',
            message: `Searched ${source}: ${hits.length} hit(s)`,
            goalId: ctx.currentGoal._id,
            tickNumber: ctx.tickNumber,
            payload: { source, hitsCount: hits.length, query },
        });

        return {
            success: true,
            action: toolName,
            resultSummary: `Searched ${source} found ${hits.length} items${
                topSnippets ? ` — ${topSnippets}` : ''
            }`.slice(0, 1500),
            payload: { source, hitsCount: hits.length, results: hits },
        };
    },
});

export class AgentToolRegistry {
    private toolsMap = new Map<string, AgentToolDefinition>();

    constructor() {
        this.registerBuiltInTools();
    }

    public register(tool: AgentToolDefinition) {
        this.toolsMap.set(tool.name, tool);
    }

    public getTool(name: string): AgentToolDefinition | undefined {
        const key = (name || '').toLowerCase().trim();
        if (['python', 'node', 'script', 'execute_script', 'run_script', 'shell_execute', 'shell'].includes(key)) {
            return this.toolsMap.get('execute_script');
        }
        if (['list_files', 'list_workspace', 'workspace_files', 'list_workspace_files'].includes(key)) {
            return this.toolsMap.get('list_workspace_files');
        }
        if (['image_to_text', 'ocr_image', 'ocr', 'vision_ocr', 'image_ocr'].includes(key)) {
            return this.toolsMap.get('image_to_text');
        }
        return this.toolsMap.get(name);
    }

    public getAllTools(): AgentToolDefinition[] {
        return Array.from(this.toolsMap.values());
    }

    public getToolDescriptions(): string {
        return this.getAllTools()
            .map((t) => `- ${t.name}: ${t.description}`)
            .join('\n');
    }

    private registerBuiltInTools() {
        // 1-5. Personal Domain Search Tools
        this.register(createDomainSearchTool('notes', 'search_notes', 'Search personal notes in database'));
        this.register(createDomainSearchTool('tasks', 'search_tasks', 'Search user task records'));
        this.register(createDomainSearchTool('lifeEvents', 'search_life_events', 'Search user life events'));
        this.register(createDomainSearchTool('infoVault', 'search_info_vault', 'Search info vault knowledge base'));
        this.register(createDomainSearchTool('memo', 'search_memo', 'Search personal memo notes'));

        // Multi-domain search — preferred first step for broad personal questions
        this.register({
            name: 'search_all_domains',
            description:
                'Search notes, tasks, memos, life events, and info vault together. Prefer this first for broad personal questions (e.g. "how to improve my life").',
            execute: async (ctx, args) => {
                const query = typeof args.query === 'string' ? args.query : ctx.currentGoal.title;
                const hits = await searchAllAgentDomains({
                    userId: ctx.userId,
                    query,
                    limitPerSource: 6,
                });

                const bySource: Record<string, number> = {};
                for (const h of hits) {
                    bySource[h.source] = (bySource[h.source] || 0) + 1;
                }

                const hitText = hits.length
                    ? hits.map((h) => `- [${h.source}] ${h.title}: ${h.summary}`).join('\n')
                    : 'No results across domains.';

                const topSnippets = hits
                    .slice(0, 3)
                    .map((h) => `[${h.source}] ${h.title}: ${(h.summary || '').slice(0, 100)}`)
                    .join(' | ');

                await ModelAgentMemory.create({
                    agentInstanceId: ctx.agentInstanceId,
                    userId: ctx.userId,
                    threadId: ctx.threadId,
                    key: `search_all_${ctx.tickNumber}`,
                    content: `Query: ${query}\nCounts: ${JSON.stringify(bySource)}\n${hitText}`.slice(0, 8000),
                    memoryType: 'observation',
                    createdAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                });

                for (const h of hits.slice(0, 16)) {
                    await ModelAgentMemory.create({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        key: `citation_${h.source}_${h.id}`.slice(0, 120),
                        content: JSON.stringify({
                            source: h.source,
                            id: h.id,
                            title: h.title,
                            summary: (h.summary || '').slice(0, 400),
                        }),
                        memoryType: 'observation',
                        createdAtUtc: new Date(),
                        updatedAtUtc: new Date(),
                    });
                }

                await writeUpdate({
                    agentInstanceId: ctx.agentInstanceId,
                    userId: ctx.userId,
                    threadId: ctx.threadId,
                    updateType: 'domain_search',
                    message: `Searched all domains: ${hits.length} hit(s)`,
                    goalId: ctx.currentGoal._id,
                    tickNumber: ctx.tickNumber,
                    payload: { source: 'all', hitsCount: hits.length, query, bySource },
                });

                return {
                    success: true,
                    action: 'search_all_domains',
                    resultSummary: `Multi-domain search found ${hits.length} items (${Object.entries(bySource)
                        .map(([k, v]) => `${k}:${v}`)
                        .join(', ') || 'none'})${topSnippets ? ` — ${topSnippets}` : ''}`.slice(0, 1500),
                    payload: { hitsCount: hits.length, bySource, results: hits },
                };
            },
        });

        // Memory Write Tool
        this.register({
            name: 'write_memory',
            description: 'Save key-value memory observation or fact into persistent agent memory',
            execute: async (ctx, args) => {
                const memoryKey = typeof args.memoryKey === 'string' ? args.memoryKey : `mem_${ctx.tickNumber}`;
                const memoryContent = typeof args.memoryContent === 'string' ? args.memoryContent : String(args.message || '');
                const memoryType = (['fact', 'observation', 'plan', 'result', 'other'] as const).includes(args.memoryType as any)
                    ? (args.memoryType as any)
                    : 'observation';

                if (memoryContent.trim()) {
                    await ModelAgentMemory.create({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        key: memoryKey.slice(0, 120),
                        content: memoryContent.slice(0, 8000),
                        memoryType,
                        createdAtUtc: new Date(),
                        updatedAtUtc: new Date(),
                    });

                    await writeUpdate({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        updateType: 'memory_written',
                        message: `Memory saved: ${memoryKey}`,
                        goalId: ctx.currentGoal._id,
                        tickNumber: ctx.tickNumber,
                    });
                }

                return {
                    success: true,
                    action: 'write_memory',
                    resultSummary: `Memory stored under key: ${memoryKey}`,
                };
            },
        });

        // List agent workspace files (for "where is the file?" follow-ups)
        this.register({
            name: 'list_workspace_files',
            description:
                'Search/list files in the Agent Workspace for this thread. The planner is not given a working directory or file dump — call this to locate uploads or created files.',
            execute: async (ctx) => {
                const agentShellDir = agentTaskFilesDir(String(ctx.threadId));
                const apiKeyDoc = await ModelUserApiKey.findOne({ userId: ctx.userId });
                if (!apiKeyDoc) {
                    return {
                        success: false,
                        action: 'list_workspace_files',
                        resultSummary: 'User API key not found',
                        error: 'api_key_missing',
                    };
                }
                const apiKey = getApiKeyByObject(apiKeyDoc);
                const shell = getAgentShellConfig(apiKey);
                if (!shell) {
                    return {
                        success: false,
                        action: 'list_workspace_files',
                        resultSummary: 'Agent Workspace is not configured in Settings → API Keys',
                        error: 'shell_not_configured',
                    };
                }

                try {
                    const shellRes = await axios.get(
                        `${shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/list`,
                        {
                            params: { relativeDir: agentShellDir, maxFiles: 500 },
                            timeout: 15_000,
                            headers: { 'X-API-Token': shell.token },
                            validateStatus: () => true,
                        }
                    );
                    const entries = normalizeAgentShellListing({
                        rawFiles:
                            shellRes.status === 200 &&
                            shellRes.data &&
                            Array.isArray((shellRes.data as { files?: unknown }).files)
                                ? (shellRes.data as { files: unknown[] }).files
                                : [],
                        agentShellDir,
                        limit: AGENT_SHELL_CONTEXT_FILE_LIMIT,
                    });
                    const listing = formatAgentShellListingForContext(entries, { maxChars: 7000 });

                    await ModelAgentMemory.create({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        key: `workspace_files_${ctx.tickNumber}`,
                        content: `Workspace ${agentShellDir}\n${listing}`.slice(0, 8000),
                        memoryType: 'observation',
                        createdAtUtc: new Date(),
                        updatedAtUtc: new Date(),
                    });

                    await writeUpdate({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        updateType: 'workspace_list',
                        message: `Listed workspace files: ${entries.length} (newest ${AGENT_SHELL_CONTEXT_FILE_LIMIT} max)`,
                        goalId: ctx.currentGoal._id,
                        tickNumber: ctx.tickNumber,
                        payload: { filesCount: entries.length, dir: agentShellDir },
                    });

                    return {
                        success: true,
                        action: 'list_workspace_files',
                        resultSummary: `Workspace files (${entries.length}): ${listing}`.slice(0, 2000),
                        payload: { filesCount: entries.length, files: entries },
                    };
                } catch (e) {
                    return {
                        success: false,
                        action: 'list_workspace_files',
                        resultSummary: e instanceof Error ? e.message : String(e),
                        error: 'list_failed',
                    };
                }
            },
        });

        this.register(createImageToTextTool());
        this.register(createOmniparserTool());

        // 6. Execute Script Tool (Node.js preference / Python 3 secondary + Code Auto-Gen & Self-Healing)
        this.register({
            name: 'execute_script',
            description:
                'Write and execute a Node.js (.js) or Python 3 (.py) script on the Agent Workspace. Scripts must exit. Never listen on ports 2000, 2001, 3000, 3010, or 3011. For Python set scriptType="python" and fileName ending in .py. For PDF use reportlab/fpdf2 or soffice; for images use Pillow.',
            execute: async (ctx, args) => {
                const thread = await ModelChatLlmThread.findById(ctx.threadId)
                    .select('executeShell')
                    .lean();
                if (!thread?.executeShell) {
                    await writeUpdate({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        updateType: 'error',
                        message:
                            'Shell execution blocked — enable “Allow shell / code execution” in thread settings.',
                        goalId: ctx.currentGoal._id,
                        tickNumber: ctx.tickNumber,
                        payload: { consentRequired: true },
                    });
                    return {
                        success: false,
                        action: 'execute_script',
                        resultSummary:
                            'Blocked: shell/code execution is not enabled for this thread. Ask the user to enable it in Thread Settings.',
                        error: 'shell_consent_required',
                    };
                }

                let rawCode =
                    typeof args.code === 'string' && args.code.trim()
                        ? args.code.trim()
                        : typeof args.script === 'string'
                          ? args.script.trim()
                          : '';
                const promptReason =
                    typeof args.reason === 'string' ? args.reason : ctx.currentGoal.description || ctx.currentGoal.title;

                let rawFileName =
                    typeof args.fileName === 'string' && args.fileName.trim() && args.fileName.trim() !== 'file'
                        ? args.fileName.trim()
                        : '';

                let scriptType = resolveScriptType(args, rawFileName, rawCode);

                // Validate code vs English text, and regenerate if the planner JSON
                // (900-token cap) or a prior call left a truncated file.
                if (
                    !isExecutableCode(rawCode, scriptType) ||
                    looksLikeIncompleteScript(rawCode, scriptType)
                ) {
                    rawCode = await generateCodeViaLlm(ctx, promptReason, scriptType);
                    // Re-resolve in case generated code is clearly the other language
                    scriptType = resolveScriptType(args, rawFileName, rawCode);
                }

                // Prefer openpyxl-only for Excel goals — pandas install loops are common under PEP 668.
                if (
                    scriptType === 'python' &&
                    /\b(pandas|ExcelWriter)\b/i.test(rawCode) &&
                    /\.(xlsx|excel)|openpyxl|password/i.test(`${promptReason}\n${rawCode}`)
                ) {
                    rawCode = await generateCodeViaLlm(
                        ctx,
                        `${promptReason}\n\nIMPORTANT: Use openpyxl only (NO pandas). openpyxl is likely already installed. Write passwords.xlsx with openpyxl.Workbook. Do not pip install unless import openpyxl fails.`,
                        'python'
                    );
                    scriptType = 'python';
                }

                // Puppeteer is not in Agent Workspace. Local npm install hits allow-scripts and false-fails.
                if (
                    /\bnpm\s+i(?:nstall)?\b[\s\S]{0,160}(puppeteer|playwright)/i.test(rawCode) ||
                    /\brequire\(\s*['"]puppeteer['"]|\bfrom\s+['"]puppeteer['"]/.test(rawCode)
                ) {
                    rawCode = await generateCodeViaLlm(
                        ctx,
                        `${promptReason}\n\nIMPORTANT: Do NOT npm install or require puppeteer/playwright (not installed in Agent Workspace; local install false-fails on allow-scripts). Use google-chrome-stable --headless --disable-gpu --no-sandbox --screenshot=shot.png file:///absolute/page.html. Print OUT=<absolute path> and SIZE=<bytes>, then stop.`,
                        'node'
                    );
                    scriptType = 'node';
                }

                // SQLite: Node `sqlite3` native addon fails in the shell. Use Python stdlib.
                if (
                    /\bsqlite|\.db\b/i.test(`${promptReason}\n${rawCode}`) &&
                    (scriptType === 'node' ||
                        /\bnpm\s+i(?:nstall)?\b[\s\S]{0,80}sqlite3|\brequire\(\s*['"]sqlite3['"]\s*\)|\bfrom ['"]sqlite3['"]/.test(
                            rawCode
                        ))
                ) {
                    rawCode = await generateCodeViaLlm(
                        ctx,
                        `${promptReason}\n\nIMPORTANT: Use python3 and the sqlite3 stdlib (import sqlite3). Do not npm-install sqlite3 or use Node. Write the .db and any result file, print OUT=<absolute path> and SIZE=<bytes> for each, then stop.`,
                        'python'
                    );
                    scriptType = 'python';
                }

                // CSV/TSV/JSON/text: pandas is not installed and pip hits PEP 668. Regen to stdlib.
                if (
                    scriptType === 'python' &&
                    /\bpandas\b/i.test(rawCode) &&
                    !/\.(xlsx|xls)\b|\bexcel\b|openpyxl/i.test(`${promptReason}\n${rawCode}`)
                ) {
                    rawCode = await generateCodeViaLlm(
                        ctx,
                        `${promptReason}\n\nIMPORTANT: Do not use pandas or pip. Use Python stdlib only (csv, json, datetime, re, pathlib). Write the output file, print OUT=<absolute path> and SIZE=<bytes>, then stop.`,
                        'python'
                    );
                    scriptType = 'python';
                }

                // Bare pip dies on PEP 668. Regen toward stdlib / --break-system-packages before running.
                if (
                    scriptType === 'python' &&
                    /\bpip3?\s+install\b/.test(rawCode) &&
                    !/--break-system-packages/.test(rawCode) &&
                    !/\.agent_venv/.test(rawCode)
                ) {
                    rawCode = await generateCodeViaLlm(
                        ctx,
                        `${promptReason}\n\nIMPORTANT: System Python is externally managed (PEP 668). Prefer the stdlib (csv, json, html.parser, re, pathlib). Do not call bare pip install. If a package is truly required (Pillow, openpyxl), use subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--break-system-packages', pkg]). Never create .agent_venv in the workspace.`,
                        'python'
                    );
                    scriptType = 'python';
                }

                const codeSafety = assertAgentShellSafe(rawCode || '');
                if (!codeSafety.ok) {
                    await writeUpdate({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        updateType: 'error',
                        message: `Shell safety: ${codeSafety.reason}`,
                        goalId: ctx.currentGoal._id,
                        tickNumber: ctx.tickNumber,
                        payload: { shellSafety: true },
                    });
                    return {
                        success: false,
                        action: 'execute_script',
                        resultSummary: `Blocked by shell safety: ${codeSafety.reason}`,
                        error: 'shell_safety_blocked',
                    };
                }

                if (!rawFileName) {
                    rawFileName = `script_${Date.now()}.${scriptType === 'python' ? 'py' : 'js'}`;
                }

                // Force extension to match interpreter (prevents node-on-.py)
                const ext = path.extname(rawFileName).toLowerCase();
                if (scriptType === 'python' && ext !== '.py') {
                    rawFileName = `${rawFileName.replace(/\.[^.]+$/, '') || rawFileName}.py`;
                } else if (scriptType === 'node' && !['.js', '.mjs', '.cjs'].includes(ext)) {
                    rawFileName = `${rawFileName.replace(/\.[^.]+$/, '') || rawFileName}.js`;
                } else if (!ext) {
                    rawFileName = `${rawFileName}.${scriptType === 'python' ? 'py' : 'js'}`;
                }

                const chatId = String(ctx.threadId);

                const apiKeyDoc = await ModelUserApiKey.findOne({ userId: ctx.userId });
                if (!apiKeyDoc) {
                    throw new Error('User API key not found');
                }
                const apiKey = getApiKeyByObject(apiKeyDoc);
                const shell = getAgentShellConfig(apiKey);
                if (!shell) {
                    throw new Error('Agent Workspace is not configured in Settings → API Keys');
                }

                const scriptRel = agentTaskFilePath(chatId, rawFileName);
                const scriptWritten = await shellWriteFile({
                    shell,
                    relativePath: scriptRel,
                    buffer: Buffer.from(rawCode || '// script execution\n', 'utf8'),
                    fileName: path.basename(rawFileName),
                    mimeType: scriptType === 'python' ? 'text/x-python' : 'application/javascript',
                    logCtx: ctx.logCtx,
                });

                const absDir = path.dirname(scriptWritten.absolutePath).replace(/\\/g, '/');
                const scriptFileName = path.basename(scriptRel);
                const absolutePath = scriptWritten.absolutePath.replace(/\\/g, '/');

                const runOnce = async (stype: 'node' | 'python'): Promise<{ stdout: string; err: string }> => {
                    const cmd = buildScriptExecCommand(stype, absDir, scriptFileName, absolutePath);
                    try {
                        const execResult = await shellExecuteCommand({
                            shell,
                            command: cmd,
                            timeoutMs: 120_000,
                            logCtx: ctx.logCtx,
                            executeFilePath: scriptRel,
                        });
                        return { stdout: execResult.stdout || '', err: '' };
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        if (shellStdoutShowsDeliverable(msg)) {
                            return { stdout: msg, err: '' };
                        }
                        return { stdout: '', err: msg };
                    }
                };

                let execStdout = '';
                let lastErr = '';
                let usedType = scriptType;

                {
                    const first = await runOnce(scriptType);
                    execStdout = first.stdout;
                    lastErr = first.err;
                    if (lastErr && shellStdoutShowsDeliverable(lastErr)) {
                        execStdout = lastErr;
                        lastErr = '';
                    }
                }

                // PEP 668: retry with --break-system-packages. Never create .agent_venv in the workspace.
                if (
                    lastErr &&
                    usedType === 'python' &&
                    /externally-managed-environment|pip.*install|No module named ['"]?(openpyxl|pandas|PIL|Pillow|bs4|beautifulsoup)/i.test(
                        lastErr
                    )
                ) {
                    try {
                        const pkgs: string[] = [];
                        if (/No module named ['"]?openpyxl/i.test(lastErr) || /\bopenpyxl\b/i.test(rawCode)) {
                            pkgs.push('openpyxl');
                        }
                        if (
                            /No module named ['"]?(PIL|Pillow)/i.test(lastErr) ||
                            /\bPIL\b|\bPillow\b/i.test(rawCode)
                        ) {
                            pkgs.push('Pillow');
                        }
                        const pip =
                            pkgs.length > 0
                                ? `python3 -m pip install -q --break-system-packages ${pkgs.join(' ')} && `
                                : '';
                        const fix = await shellExecuteCommand({
                            shell,
                            command:
                                `cd "${absDir.replace(/"/g, '')}" && ` +
                                `${pip}` +
                                `python3 "./${scriptFileName.replace(/"/g, '')}" 2>&1`,
                            timeoutMs: 180_000,
                            logCtx: ctx.logCtx,
                            executeFilePath: scriptRel,
                        });
                        execStdout = fix.stdout || '';
                        lastErr = '';
                    } catch (err) {
                        lastErr = err instanceof Error ? err.message : String(err);
                    }
                }

                // Deterministic interpreter fix: never LLM-repair "node ran a .py"
                if (
                    lastErr &&
                    usedType === 'node' &&
                    (/\.py$/i.test(scriptFileName) ||
                        /ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension ["']\.py["']/i.test(lastErr))
                ) {
                    const second = await runOnce('python');
                    if (!second.err || second.stdout) {
                        execStdout = second.stdout;
                        lastErr = second.err;
                        usedType = 'python';
                    }
                }

                // Path miss: retry once with absolute path only
                if (lastErr && /can't open file|No such file or directory|Script not found/i.test(lastErr)) {
                    const runner = usedType === 'python' ? 'python3' : 'node';
                    try {
                        const retry = await shellExecuteCommand({
                            shell,
                            command: `${runner} "${absolutePath}" 2>&1`,
                            timeoutMs: 120_000,
                            logCtx: ctx.logCtx,
                            executeFilePath: scriptRel,
                        });
                        execStdout = retry.stdout || '';
                        lastErr = '';
                    } catch (err) {
                        lastErr = err instanceof Error ? err.message : String(err);
                    }
                }

                if (lastErr) {
                    await writeAgentLog({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        action: 'shell_error',
                        title: `Script execution error for ${rawFileName}`,
                        message: lastErr,
                        level: 'warn',
                        goalId: ctx.currentGoal._id,
                        tickNumber: ctx.tickNumber,
                    });

                    // LLM Self-Healing Repair — use the correct interpreter (never hardcode node for .py)
                    if (ctx.logCtx) {
                        try {
                            const llmConfig = await getLlmConfig({ threadId: ctx.threadId });
                            if (llmConfig) {
                                const runner = usedType === 'python' ? 'python3' : 'node';
                                const repairMessages: Message[] = [
                                    {
                                        role: 'system',
                                        content:
                                            `You are a script repair engineer. The script is ${scriptFileName} (${usedType}). ` +
                                            `Working directory should be: ${absDir}. Absolute path: ${absolutePath}. ` +
                                            `Return JSON ONLY: {"command":"fixed shell command"}. ` +
                                            `The command MUST use ${runner} (not the wrong interpreter). Example: ` +
                                            `cd "${absDir}" && ${runner} "./${scriptFileName}" 2>&1`,
                                    },
                                    {
                                        role: 'user',
                                        content: `Script execution error:\n${lastErr}\n\nFile relative path: ${scriptRel}\nScript type: ${usedType}\nScript code preview:\n${rawCode.slice(0, 1500)}`,
                                    },
                                ];

                                const llmRepairRes = await fetchLlmUnifiedLogged({
                                    logCtx: ctx.logCtx,
                                    purpose: 'agent_shell_script_repair',
                                    params: {
                                        provider: llmConfig.provider,
                                        apiKey: llmConfig.apiKey,
                                        apiEndpoint: llmConfig.apiEndpoint,
                                        model: llmConfig.model,
                                        messages: repairMessages,
                                        temperature: 0.2,
                                        maxTokens: 1000,
                                        responseFormat: 'json_object',
                                    },
                                });

                                let repairCmd = '';
                                try {
                                    const parsed = JSON.parse(llmRepairRes.content || '{}');
                                    repairCmd = typeof parsed.command === 'string' ? parsed.command.trim() : '';
                                } catch {
                                    /* pass */
                                }

                                // Guard: refuse repair cmds that run .py with node
                                if (
                                    repairCmd &&
                                    usedType === 'python' &&
                                    /\bnode\b/.test(repairCmd) &&
                                    !/\bpython3?\b/.test(repairCmd)
                                ) {
                                    repairCmd = `cd "${absDir}" && python3 "./${scriptFileName}" 2>&1`;
                                }

                                if (repairCmd) {
                                    try {
                                        const repairResult = await shellExecuteCommand({
                                            shell,
                                            command: `${repairCmd} 2>&1`,
                                            timeoutMs: 120_000,
                                            logCtx: ctx.logCtx,
                                        });
                                        execStdout = repairResult.stdout || 'Repaired command executed successfully';
                                        lastErr = '';
                                    } catch (rErr) {
                                        lastErr = rErr instanceof Error ? rErr.message : String(rErr);
                                    }
                                }
                            }
                        } catch (repairError) {
                            console.error('Script LLM repair failed:', repairError);
                        }
                    }
                }

                if (lastErr && shellStdoutShowsDeliverable(`${execStdout}\n${lastErr}`)) {
                    execStdout = `${execStdout}\n${lastErr}`.trim();
                    lastErr = '';
                }

                if (lastErr && !execStdout) {
                    const errorMsg = `Script execution failed: ${lastErr}`.trim();

                    await ModelAgentMemory.create({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        key: `script_err_${ctx.tickNumber}`,
                        content: errorMsg.slice(-1000),
                        memoryType: 'observation',
                        createdAtUtc: new Date(),
                        updatedAtUtc: new Date(),
                    });

                    await writeUpdate({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        updateType: 'error',
                        message: errorMsg.slice(0, 500),
                        goalId: ctx.currentGoal._id,
                        tickNumber: ctx.tickNumber,
                    });

                    return {
                        success: false,
                        action: 'execute_script',
                        resultSummary: 'Script execution failed',
                        error: lastErr,
                    };
                }

                await writeUpdate({
                    agentInstanceId: ctx.agentInstanceId,
                    userId: ctx.userId,
                    threadId: ctx.threadId,
                    updateType: 'script_executed',
                    message: `Executed ${usedType} script: ${rawFileName}`,
                    goalId: ctx.currentGoal._id,
                    tickNumber: ctx.tickNumber,
                    payload: { scriptType: usedType, fileName: rawFileName, stdout: execStdout.slice(0, 1000) },
                });

                const pathMatches =
                    execStdout.match(
                        /(?:PDF_PATH=|Excel file ready.*?|absolutePath[=:\s"]+|\/config\/[^\s"'<>|]+\.(?:pdf|xlsx|xls|csv|png|jpe?g|webp|gif|zip|docx)|ai-notes-xyz-agent-workspace\/[^\s"'<>|]+\.(?:pdf|xlsx|xls|csv|png|jpe?g|webp|gif|zip|docx))/gi
                    ) || [];
                const cleanedPaths = pathMatches
                    .map((p) => p.replace(/^PDF_PATH=/i, '').replace(/^absolutePath[=:\s"]+/i, '').replace(/["']/g, ''))
                    .filter((p) => /\.(pdf|xlsx|xls|csv|png|jpe?g|webp|gif|zip|docx)$/i.test(p));
                if (cleanedPaths.length > 0 || /\.(pdf|xlsx|png|jpe?g)\b/i.test(execStdout)) {
                    await ModelAgentMemory.create({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        key: `artifact_${ctx.tickNumber}`,
                        content: (
                            cleanedPaths.length
                                ? `Created artifact(s):\n${cleanedPaths.join('\n')}\n\nStdout:\n${execStdout.slice(0, 3000)}`
                                : `Script output (look for file paths):\n${execStdout.slice(0, 4000)}`
                        ).slice(0, 8000),
                        memoryType: 'result',
                        createdAtUtc: new Date(),
                        updatedAtUtc: new Date(),
                    });
                }

                return {
                    success: true,
                    action: 'execute_script',
                    resultSummary: `Script ${rawFileName} executed. Output: ${execStdout.slice(0, 500)}${
                        cleanedPaths.length ? ` | paths: ${cleanedPaths.join(', ')}` : ''
                    }`.slice(0, 1500),
                    payload: { stdout: execStdout, artifactPaths: cleanedPaths },
                };
            },
        });

        // 7. Post Message Tool
        this.register({
            name: 'post_message',
            description: 'Post a progress update or text message directly to the chat thread',
            execute: async (ctx, args) => {
                const msg = typeof args.message === 'string' ? args.message.trim() : String(args.goalResult || '').trim();
                if (msg) {
                    await ModelChatLlm.create({
                        type: 'text',
                        content: msg,
                        userId: ctx.userId.toString(),
                        threadId: ctx.threadId,
                        isAi: true,
                        tags: ['agent'],
                        aiModelProvider: ctx.llmConfig?.provider || '',
                        aiModelName: ctx.llmConfig?.model || '',
                        createdAtUtc: new Date(),
                        updatedAtUtc: new Date(),
                    });
                    await writeUpdate({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        updateType: 'message',
                        message: msg.slice(0, 500),
                        goalId: ctx.currentGoal._id,
                        tickNumber: ctx.tickNumber,
                    });
                }
                return {
                    success: true,
                    action: 'post_message',
                    resultSummary: `Message posted to thread`,
                };
            },
        });

        // 8. Complete Goal Tool
        this.register({
            name: 'complete_goal',
            description: 'Mark current goal as completed with final result summary',
            execute: async (ctx, args) => {
                const goalResult = typeof args.goalResult === 'string' ? args.goalResult : String(args.message || args.reason || '');
                ctx.currentGoal.status = 'completed';
                ctx.currentGoal.result = goalResult.slice(0, 8000);
                ctx.currentGoal.completedAtUtc = new Date();
                ctx.currentGoal.updatedAtUtc = new Date();
                await ctx.currentGoal.save();

                await ModelAgentMemory.create({
                    agentInstanceId: ctx.agentInstanceId,
                    userId: ctx.userId,
                    threadId: ctx.threadId,
                    key: `goal_${ctx.currentGoal.orderIndex}_result`,
                    content: ctx.currentGoal.result,
                    memoryType: 'result',
                    createdAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                });

                await writeUpdate({
                    agentInstanceId: ctx.agentInstanceId,
                    userId: ctx.userId,
                    threadId: ctx.threadId,
                    updateType: 'goal_completed',
                    message: `Completed goal: ${ctx.currentGoal.title}`,
                    goalId: ctx.currentGoal._id,
                    tickNumber: ctx.tickNumber,
                    payload: { result: ctx.currentGoal.result },
                });

                await ModelChatLlm.create({
                    type: 'text',
                    content: `Goal completed: ${ctx.currentGoal.title}\n\n${ctx.currentGoal.result || '(no details)'}`,
                    userId: ctx.userId.toString(),
                    threadId: ctx.threadId,
                    isAi: true,
                    tags: ['agent'],
                    aiModelProvider: ctx.llmConfig?.provider || '',
                    aiModelName: ctx.llmConfig?.model || '',
                    createdAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                });

                return {
                    success: true,
                    action: 'complete_goal',
                    resultSummary: `Goal completed: ${ctx.currentGoal.title}`,
                };
            },
        });

        // 9. Fail Goal Tool
        this.register({
            name: 'fail_goal',
            description: 'Mark current goal as failed with error reason',
            execute: async (ctx, args) => {
                const goalResult = typeof args.goalResult === 'string' ? args.goalResult : String(args.reason || args.message || 'Failed');
                ctx.currentGoal.status = 'failed';
                ctx.currentGoal.result = goalResult.slice(0, 8000);
                ctx.currentGoal.completedAtUtc = new Date();
                ctx.currentGoal.updatedAtUtc = new Date();
                await ctx.currentGoal.save();

                await ModelAgentMemory.create({
                    agentInstanceId: ctx.agentInstanceId,
                    userId: ctx.userId,
                    threadId: ctx.threadId,
                    key: `goal_${ctx.currentGoal.orderIndex}_result`,
                    content: ctx.currentGoal.result,
                    memoryType: 'result',
                    createdAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                });

                await writeUpdate({
                    agentInstanceId: ctx.agentInstanceId,
                    userId: ctx.userId,
                    threadId: ctx.threadId,
                    updateType: 'goal_failed',
                    message: `Failed goal: ${ctx.currentGoal.title}`,
                    goalId: ctx.currentGoal._id,
                    tickNumber: ctx.tickNumber,
                    payload: { result: ctx.currentGoal.result },
                });

                await ModelChatLlm.create({
                    type: 'text',
                    content: `Goal failed: ${ctx.currentGoal.title}\n\n${ctx.currentGoal.result || '(no details)'}`,
                    userId: ctx.userId.toString(),
                    threadId: ctx.threadId,
                    isAi: true,
                    tags: ['agent'],
                    aiModelProvider: ctx.llmConfig?.provider || '',
                    aiModelName: ctx.llmConfig?.model || '',
                    createdAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                });

                return {
                    success: false,
                    action: 'fail_goal',
                    resultSummary: `Goal failed: ${ctx.currentGoal.title}`,
                    error: ctx.currentGoal.result,
                };
            },
        });

        // Noop Tool
        this.register({
            name: 'noop',
            description: 'Pass control to next tick',
            execute: async () => ({
                success: true,
                action: 'noop',
                resultSummary: 'Noop executed',
            }),
        });
    }
}

export const defaultAgentToolRegistry = new AgentToolRegistry();
