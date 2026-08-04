import mongoose from 'mongoose';
import path from 'path';
import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentMemory } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentUpdate } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import { Message } from '../../../../utils/llmPendingTask/utils/fetchLlmUnified';
import { getLlmConfig } from '../answerMachineShared/answerMachineGetLlmConfig';
import { AgentToolContext, AgentToolDefinition, AgentToolResult } from './agentToolTypes';
import { searchAgentDomain, AgentDomainSearchSource } from './agentDomainAccess';
import axios from 'axios';
import { agentTaskFilesDir, agentTaskFilePath, getAgentShellConfig, shellExecuteCommand, shellWriteFile } from './agentShellWorkspace';
import writeAgentLog, { fetchLlmUnifiedLogged } from './agentWriteLog';

const updateTypeToLogAction = (updateType: string, payload?: Record<string, unknown>): string => {
    if (updateType === 'tick') {
        const action = typeof payload?.action === 'string' ? payload.action : '';
        if (action === 'noop') return 'noop';
        return action ? 'llm_decision' : 'tick_end';
    }
    if (updateType === 'message') return 'message_posted';
    if (updateType === 'error') return 'agent_error';
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
        return /\b(import|from|def|class|print|with|open|sys|os)\b/.test(clean);
    }
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

    const agentShellDir = agentTaskFilesDir(String(ctx.threadId));
    let fileListText = '(no workspace files listed)';
    try {
        const apiKeyDoc = await ModelUserApiKey.findOne({ userId: ctx.userId });
        if (apiKeyDoc) {
            const apiKey = getApiKeyByObject(apiKeyDoc);
            const shell = getAgentShellConfig(apiKey);
            if (shell) {
                const shellRes = await axios.get(
                    `${shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/list`,
                    {
                        params: { relativeDir: agentShellDir, maxFiles: 100 },
                        timeout: 5000,
                        headers: { 'X-API-Token': shell.token },
                        validateStatus: () => true,
                    }
                );
                if (shellRes.status === 200 && shellRes.data && Array.isArray((shellRes.data as any).files)) {
                    fileListText = (shellRes.data as any).files
                        .map((f: any) => {
                            const rel = String(f.relativePath || '').replace(/\\/g, '/');
                            const abs = String(f.absolutePath || '').replace(/\\/g, '/');
                            const folderIdx = rel.indexOf(`${agentShellDir}/`);
                            const localRel = folderIdx !== -1 ? rel.slice(folderIdx + agentShellDir.length + 1) : rel;
                            return `- absolutePath: "${abs || `/app/data/${rel}`}"\n  pathInAgentFolder: "${localRel}"\n  size: ${f.size || 0} bytes`;
                        })
                        .join('\n');
                }
            }
        }
    } catch {
        /* ignore */
    }

    const messages: Message[] = [
        {
            role: 'system',
            content: `You are an expert ${scriptType === 'node' ? 'Node.js' : 'Python 3'} developer. Write executable, complete, production-ready ${scriptType === 'node' ? 'Node.js' : 'Python 3'} code to fulfill the task. Do NOT include markdown text, explanations, or backticks. Return raw executable code ONLY. Save output files using Node.js 'fs' or Python 'open' if needed.`,
        },
        {
            role: 'user',
            content: `Goal / Task: ${promptText}
Goal Title: ${ctx.currentGoal.title}
Goal Description: ${ctx.currentGoal.description}

Available Workspace Directory: ${agentShellDir}
Available Files in Workspace & Uploads:
${fileListText}

CRITICAL FILE PATH RULES:
- Use either the exact \`absolutePath\` (e.g. '/app/data/ai-notes-xyz-shell-files/agent/...') OR \`pathInAgentFolder\` (e.g. 'uploads/filename.jpg').
- NEVER use full workspace prefix 'ai-notes-xyz-shell-files/agent/...' as a relative path when running inside the agent folder!
- Do NOT use placeholder/imaginary filenames like 'input.jpg', 'image.png', or 'test.txt'. Use the real file paths from the listing above.
- Save output files directly in the workspace directory or uploads/ folder.`,
        },
    ];

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
            maxTokens: 3000,
        },
    });

    let rawCode = res.content || '';
    rawCode = rawCode.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
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
            resultSummary: `Searched ${source} found ${hits.length} items`,
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
        // 1-4. Personal Domain Search Tools
        this.register(createDomainSearchTool('notes', 'search_notes', 'Search personal notes in database'));
        this.register(createDomainSearchTool('tasks', 'search_tasks', 'Search user task records'));
        this.register(createDomainSearchTool('lifeEvents', 'search_life_events', 'Search user life events'));
        this.register(createDomainSearchTool('infoVault', 'search_info_vault', 'Search info vault knowledge base'));

        // 5. Memory Write Tool
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

        // 6. Execute Script Tool (Node.js preference / Python 3 secondary + Code Auto-Gen & Self-Healing)
        this.register({
            name: 'execute_script',
            description: 'Write and execute a Node.js (.js) or Python 3 (.py) script on the Shell Engine workspace (ai-notes-xyz-shell-files/agent/chat_id). Preference: (1) Node.js, (2) Python 3.',
            execute: async (ctx, args) => {
                const scriptType = (typeof args.scriptType === 'string' && args.scriptType.toLowerCase() === 'python') || args.action === 'python' ? 'python' : 'node';
                let rawCode = typeof args.code === 'string' && args.code.trim() ? args.code.trim() : (typeof args.script === 'string' ? args.script.trim() : '');
                const promptReason = typeof args.reason === 'string' ? args.reason : ctx.currentGoal.description || ctx.currentGoal.title;

                // Validate code vs English text
                if (!isExecutableCode(rawCode, scriptType)) {
                    rawCode = await generateCodeViaLlm(ctx, promptReason, scriptType);
                }

                let rawFileName = typeof args.fileName === 'string' && args.fileName.trim() && args.fileName.trim() !== 'file'
                    ? args.fileName.trim()
                    : `script_${Date.now()}.${scriptType === 'python' ? 'py' : 'js'}`;

                if (!path.extname(rawFileName)) {
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
                    throw new Error('Shell Engine is not configured in Settings → API Keys');
                }

                const scriptRel = agentTaskFilePath(chatId, rawFileName);
                const scriptWritten = await shellWriteFile({
                    shell,
                    relativePath: scriptRel,
                    buffer: Buffer.from(rawCode || '// script execution\n', 'utf8'),
                    fileName: rawFileName,
                    mimeType: scriptType === 'python' ? 'text/x-python' : 'application/javascript',
                    logCtx: ctx.logCtx,
                });

                const absDir = path.dirname(scriptWritten.absolutePath).replace(/\\/g, '/');
                const relDir = path.dirname(scriptRel).replace(/\\/g, '/');
                const scriptFileName = path.basename(scriptRel);

                const findDirCmd = `TARGET_DIR=$(find /app /data /root /tmp / -type f -name "${scriptFileName}" 2>/dev/null | head -n 1 | xargs dirname 2>/dev/null); if [ -n "$TARGET_DIR" ]; then cd "$TARGET_DIR"; else cd "${absDir}" 2>/dev/null || cd "${relDir}" 2>/dev/null || cd "/app/${relDir}" 2>/dev/null; fi`;

                const execCmd = scriptType === 'node'
                    ? `(${findDirCmd}) && node "${scriptFileName}" 2>&1`
                    : `(${findDirCmd}) && (python3 "${scriptFileName}" 2>&1 || python "${scriptFileName}" 2>&1)`;

                let execStdout = '';
                let lastErr = '';
                try {
                    const execResult = await shellExecuteCommand({
                        shell,
                        command: execCmd,
                        timeoutMs: 120_000,
                        logCtx: ctx.logCtx,
                    });
                    execStdout = execResult.stdout || '';
                } catch (err) {
                    lastErr = err instanceof Error ? err.message : String(err);
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

                    // LLM Self-Healing Repair
                    if (ctx.logCtx) {
                        try {
                            const llmConfig = await getLlmConfig({ threadId: ctx.threadId });
                            if (llmConfig) {
                                const repairMessages: Message[] = [
                                    {
                                        role: 'system',
                                        content: `You are a script repair engineer. To execute ${scriptFileName} on the container, use find to locate its folder: TARGET_DIR=$(find /app /data /root /tmp / -type f -name '${scriptFileName}' 2>/dev/null | head -n 1 | xargs dirname); cd "$TARGET_DIR" && node '${scriptFileName}' 2>&1. Return JSON ONLY: {"command": "fixed shell command"}`,
                                    },
                                    {
                                        role: 'user',
                                        content: `Script execution error:\n${lastErr}\n\nFile relative path: ${scriptRel}\nScript code preview:\n${rawCode.slice(0, 1500)}`,
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

                if (lastErr && !execStdout) {
                    const errorMsg = `Script execution failed: ${lastErr}`.trim();
                    
                    await ModelAgentMemory.create({
                        agentInstanceId: ctx.agentInstanceId,
                        userId: ctx.userId,
                        threadId: ctx.threadId,
                        key: `script_err_${ctx.tickNumber}`,
                        content: errorMsg.slice(-1000), // Keep the end of the error where the actual issue usually is
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
                    message: `Executed ${scriptType} script: ${rawFileName}`,
                    goalId: ctx.currentGoal._id,
                    tickNumber: ctx.tickNumber,
                    payload: { scriptType, fileName: rawFileName, stdout: execStdout.slice(0, 1000) },
                });

                return {
                    success: true,
                    action: 'execute_script',
                    resultSummary: `Script ${rawFileName} executed. Output: ${execStdout.slice(0, 200)}`,
                    payload: { stdout: execStdout },
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

        // 10. Noop Tool
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
