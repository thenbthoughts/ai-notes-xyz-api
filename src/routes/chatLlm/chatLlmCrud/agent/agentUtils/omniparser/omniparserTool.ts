import { ModelAgentMemory } from '../../../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelUserApiKey } from '../../../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../../../utils/llm/llmCommonFunc';
import { shellReadFile } from '../agentShell/agentShellWorkspace';
import { getAgentShellConfig, agentTaskFilesDir } from '../agentShell/agentShellWorkspace';
import { writeUpdate } from '../../agentWork/agentToolRegistry';
import type { AgentToolDefinition } from '../../agentWork/agentToolTypes';
import { callOmniparser } from './omniparserClient';
import { getLlmConfig } from '../../../chatUtils/chatLlmGetLlmConfig';

/**
 * Omniparser for desktop only: parse desktop screenshot via microsoft/omniparser-v2 (Replicate) when replicate key exists and useOmniparser toggle is on.
 * Not for input files (uploads/); use image_to_text for input files. Shell-first: try shell first, omniparser only for desktop screenshots.
 */
export const createOmniparserTool = (): AgentToolDefinition => ({
    name: 'omniparser_parse',
    description: 'Parse a DESKTOP screenshot via microsoft/omniparser-v2 (Replicate) to get UI elements (x,y,type,text). Use ONLY for desktop screenshots (e.g., gui.png, screen.png, out.png from chrome --headless --screenshot), NOT for input files in uploads/. Use image_to_text for input files. Requires Replicate key and chat toggle on. Input: relativePath to desktop screenshot.',
    execute: async (ctx, args) => {
        const threadId = ctx.threadId;
        const apiKeyDoc = await ModelUserApiKey.findOne({ userId: ctx.userId });
        if (!apiKeyDoc) {
            return { success: false, action: 'omniparser_parse', resultSummary: 'User API key not found', error: 'api_key_missing' };
        }
        const apiKey = getApiKeyByObject(apiKeyDoc);
        if (!apiKey.apiKeyReplicateValid || !apiKey.apiKeyReplicate?.trim()) {
            return { success: false, action: 'omniparser_parse', resultSummary: 'Replicate API key not configured — add in Settings → API Keys', error: 'replicate_key_missing' };
        }

        // Check thread toggle
        const { ModelChatLlmThread } = await import('../../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema');
        const thread = await ModelChatLlmThread.findById(threadId).select('useOmniparser').lean() as { useOmniparser?: boolean } | null;
        if (thread && thread.useOmniparser === false) {
            return { success: false, action: 'omniparser_parse', resultSummary: 'Omniparser disabled in chat options (toggle off)', error: 'omniparser_disabled' };
        }

        const relativePathRaw = typeof args.relativePath === 'string' ? args.relativePath.trim() : typeof args.imagePath === 'string' ? args.imagePath.trim() : typeof args.path === 'string' ? args.path.trim() : '';
        if (!relativePathRaw) {
            return { success: false, action: 'omniparser_parse', resultSummary: 'Missing relativePath to screenshot image (e.g., out.png)', error: 'missing_path' };
        }

        const shell = getAgentShellConfig(apiKey);
        if (!shell) {
            return { success: false, action: 'omniparser_parse', resultSummary: 'Agent workspace not configured', error: 'shell_not_configured' };
        }

        // Resolve relative path: if not already prefixed with agent dir, prefix it
        const agentDir = agentTaskFilesDir(String(threadId));
        let relativePath = relativePathRaw.replace(/\\/g, '/');
        if (!relativePath.startsWith('ai-notes-xyz-agent-workspace/')) {
            // If just filename like out.png, assume workspace root
            if (!relativePath.includes('/')) relativePath = `${agentDir}/${relativePath}`;
            else if (!relativePath.startsWith(agentDir)) relativePath = `${agentDir}/${relativePath}`;
        }

        // Desktop only: reject input files in uploads/ or with input-like names
        const lowerPath = relativePath.toLowerCase();
        if (lowerPath.includes('/uploads/') || lowerPath.includes('input.') || /college_.*\.jpg$/i.test(lowerPath)) {
            return {
                success: false,
                action: 'omniparser_parse',
                resultSummary: `Omniparser is desktop-only (e.g., gui.png, screen.png from chrome --headless --screenshot). Input files in uploads/ should use image_to_text instead. Path ${relativePathRaw} looks like input file.`,
                error: 'desktop_only',
            };
        }

        try {
            const buf = await shellReadFile({ shell, relativePath, logCtx: ctx.logCtx });
            const base64 = buf.toString('base64');

            const result = await callOmniparser({ replicateApiKey: apiKey.apiKeyReplicate, imageBase64: base64 });

            const summary = `Omniparser parsed ${result.elements.length} elements${result.elements.slice(0, 3).map((e) => ` [${e.type || 'elem'}@${Math.round(e.x)},${Math.round(e.y)}]`).join('')}`.slice(0, 1500);

            await ModelAgentMemory.create({
                agentInstanceId: ctx.agentInstanceId,
                userId: ctx.userId,
                threadId: ctx.threadId,
                key: `omniparser_result_${ctx.tickNumber}`,
                content: JSON.stringify({ path: relativePath, elements: result.elements.slice(0, 50), raw: result.raw }, null, 2).slice(0, 8000),
                memoryType: 'observation',
                createdAtUtc: new Date(),
                updatedAtUtc: new Date(),
            });

            await writeUpdate({
                agentInstanceId: ctx.agentInstanceId,
                userId: ctx.userId,
                threadId: ctx.threadId,
                updateType: 'tool_result',
                message: summary,
                goalId: ctx.currentGoal._id,
                tickNumber: ctx.tickNumber,
                payload: { elementsCount: result.elements.length, path: relativePath },
            });

            return { success: true, action: 'omniparser_parse', resultSummary: summary, payload: { elements: result.elements, path: relativePath } };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { success: false, action: 'omniparser_parse', resultSummary: `Omniparser failed: ${msg}`.slice(0, 1500), error: msg.slice(0, 1000) };
        }
    },
});
