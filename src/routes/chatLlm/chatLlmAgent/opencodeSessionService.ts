import mongoose from 'mongoose';

import { ModelChatLlmThreadOpencodeSession } from '../../../schema/schemaChatLlm/SchemaChatLlmThreadOpencodeSession.schema';
import { ModelUser } from '../../../schema/schemaUser/SchemaUser.schema';
import type { tsUserApiKey } from '../../../utils/llm/llmCommonFunc';

import {
    configureOpencodeProviderApiKey,
    createAuthenticatedOpencodeSdkClientForUser,
    createOpencodeAgentSessionId,
    OpencodeSdkClient,
    runOpencodePtyBashCommand,
} from './utils/opencodeSdkHelpers';
import {
    bashSingleQuote,
    buildThreadScopedOpencodeWorkspaceRoot,
    OPENCODE_THREAD_SUBDIR_CODEEXECUTION,
    OPENCODE_THREAD_SUBDIR_INPUTFILES,
    OPENCODE_THREAD_SUBDIR_OUTPUTFILES,
    sanitizeLinuxPathSegment,
} from './utils/opencodeWorkspacePaths';

async function ensureOpencodeThreadWorkspaceLayout(client: OpencodeSdkClient, workspaceRoot: string): Promise<void> {
    const q = bashSingleQuote(workspaceRoot.replace(/\/+$/, ''));
    const cmd = `mkdir -p ${q}/${OPENCODE_THREAD_SUBDIR_INPUTFILES} ${q}/${OPENCODE_THREAD_SUBDIR_OUTPUTFILES} ${q}/${OPENCODE_THREAD_SUBDIR_CODEEXECUTION}`;
    try {
        await runOpencodePtyBashCommand(client, {
            workspaceDirectory: workspaceRoot,
            command: cmd,
            title: 'opencode-init-thread-workspace',
            remoteCwd: '/app',
        });
    } catch {
        // best-effort; agent may still create dirs
    }
}

export async function getOrCreateThreadOpencodeSession({
    username,
    threadId,
    userApiKey,
}: {
    username: string;
    threadId: mongoose.Types.ObjectId;
    userApiKey: tsUserApiKey;
}): Promise<{
    client: OpencodeSdkClient;
    workspaceDirectory: string;
    sdkSessionId: string;
    errorReason: string;
}> {
    const userDoc = await ModelUser.findOne({ username }).select('_id').lean();
    const userIdForPath =
        userDoc && userDoc._id
            ? userDoc._id.toString()
            : sanitizeLinuxPathSegment(username);
    const workspaceDirectory = buildThreadScopedOpencodeWorkspaceRoot(userIdForPath, threadId);
    const client = await createAuthenticatedOpencodeSdkClientForUser(userApiKey, workspaceDirectory);
    if (!client) {
        return {
            client: null as unknown as OpencodeSdkClient,
            workspaceDirectory,
            sdkSessionId: '',
            errorReason: 'OpenCode is not configured',
        };
    }

    await ensureOpencodeThreadWorkspaceLayout(client, workspaceDirectory);

    if (userApiKey.apiKeyOpenrouterValid && userApiKey.apiKeyOpenrouter.trim().length >= 1) {
        try {
            await configureOpencodeProviderApiKey(
                client,
                'openrouter',
                userApiKey.apiKeyOpenrouter.trim()
            );
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[opencode] OpenRouter auth.set on OpenCode host failed:', msg);
        }
    }

    const existing = await ModelChatLlmThreadOpencodeSession.findOne({
        threadId,
        username,
    });

    if (existing && typeof existing.sdkSessionId === 'string' && existing.sdkSessionId.trim().length >= 1) {
        return {
            client,
            workspaceDirectory,
            sdkSessionId: existing.sdkSessionId,
            errorReason: '',
        };
    }

    const sdkSessionId = await createOpencodeAgentSessionId(client);

    await ModelChatLlmThreadOpencodeSession.updateOne(
        { threadId, username },
        {
            $set: {
                threadId,
                username,
                workspaceDirectory,
                sdkSessionId,
                updatedAtUtc: new Date(),
            },
            $setOnInsert: {
                createdAtUtc: new Date(),
            },
        },
        { upsert: true }
    );

    return { client, workspaceDirectory, sdkSessionId, errorReason: '' };
}

