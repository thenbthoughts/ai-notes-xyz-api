import mongoose from 'mongoose';

import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { ModelAgentGoalExpansion } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoalExpansion.schema';
import { ModelAgentUpdate } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelAgentLog } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentLog.schema';
import { ModelAgentMemory } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentFinal } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentFinal.schema';
import { ModelAgentCitation } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentCitation.schema';
import { ModelChatShellRunGroup } from '../../../../schema/schemaChatLlm/SchemaShellExecute/SchemaChatShellRunGroup.schema';
import { ModelChatShellRunTodo } from '../../../../schema/schemaChatLlm/SchemaShellExecute/SchemaChatShellRunTodo.schema';
import { ModelChatShellGeneratedFile } from '../../../../schema/schemaChatLlm/SchemaShellExecute/SchemaChatShellGeneratedFile.schema';
import cancelPendingAgentTickTasks from '../../../../utils/llmPendingTask/page/agent/cancelPendingAgentTickTasks';
import type { tsUserApiKey } from '../../../../utils/llm/llmCommonFunc';
import {
    agentTaskFilesDir,
    getAgentShellConfig,
    shellDeleteRelativePath,
} from '../../chatLlmCrud/agent/agentUtils/agentShell/agentShellWorkspace';
import { AGENT_WORKSPACE_SHELL_PREFIX } from '../../../../utils/agentWorkspace/agentWorkspacePaths';
import cleanupAgentOpencodeForThread from '../../chatLlmCrud/agentOpencode/agentOpencodeCleanup';

/** Concise / chat-shell workspace for a thread. */
const shellThreadWorkspaceRelativeDir = (threadId: mongoose.Types.ObjectId): string =>
    `${AGENT_WORKSPACE_SHELL_PREFIX}/thread-${String(threadId)}`;

/**
 * On conversation delete: remove agent + chat-shell DB rows and shell workspace folders.
 * Shell cleanup is best-effort (missing engine / missing folder is ignored).
 */
const cleanupThreadOnDelete = async ({
    threadId,
    userId,
    apiKey,
}: {
    threadId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId | string;
    apiKey: tsUserApiKey;
}): Promise<void> => {
    const userObjectId =
        typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    const agents = await ModelAgentInstance.find({
        threadId,
        userId: userObjectId,
    })
        .select('_id')
        .lean();
    const agentIds = agents.map((a) => a._id as mongoose.Types.ObjectId);

    if (agentIds.length > 0) {
        await cancelPendingAgentTickTasks({ agentInstanceId: agentIds });
    }

    await cleanupAgentOpencodeForThread({
        threadId,
        userId: userObjectId,
        apiKey,
    });

    await Promise.all([
        ModelAgentMemory.deleteMany({ threadId }),
        ModelAgentLog.deleteMany({ threadId }),
        ModelAgentUpdate.deleteMany({ threadId }),
        ModelAgentGoal.deleteMany({ threadId }),
        ModelAgentGoalExpansion.deleteMany({ threadId }),
        ModelAgentCitation.deleteMany({ threadId }),
        ModelAgentFinal.deleteMany({ threadId }),
        ModelAgentInstance.deleteMany({ threadId, userId: userObjectId }),
    ]);

    const shellGroups = await ModelChatShellRunGroup.find({
        threadId,
        userId: userObjectId,
    })
        .select('_id')
        .lean();
    const groupIds = shellGroups.map((g) => g._id as mongoose.Types.ObjectId);

    if (groupIds.length > 0) {
        await Promise.all([
            ModelChatShellRunTodo.deleteMany({ chatShellRunGroupId: { $in: groupIds } }),
            ModelChatShellGeneratedFile.deleteMany({ chatShellRunGroupId: { $in: groupIds } }),
        ]);
        await ModelChatShellRunGroup.deleteMany({ _id: { $in: groupIds } });
    }

    const shell = getAgentShellConfig(apiKey);
    if (!shell) {
        return;
    }

    const dirs = [
        agentTaskFilesDir(String(threadId)),
        shellThreadWorkspaceRelativeDir(threadId),
    ];

    for (const relativePath of dirs) {
        try {
            const result = await shellDeleteRelativePath({ shell, relativePath });
            if (!result.ok) {
                console.warn('[cleanupThreadOnDelete] shell folder delete:', relativePath, result.error);
            }
        } catch (err) {
            console.warn('[cleanupThreadOnDelete] shell folder delete error:', relativePath, err);
        }
    }
};

export default cleanupThreadOnDelete;
