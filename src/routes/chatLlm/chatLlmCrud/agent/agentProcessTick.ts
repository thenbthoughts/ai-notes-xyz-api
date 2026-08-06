import mongoose from 'mongoose';
import axios from 'axios';
import { ModelChatLlm } from '../../../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { ModelAgentInstance } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentInstance.schema';
import { ModelAgentGoal } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentGoal.schema';
import { IAgentGoal } from '../../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentGoal.types';
import { ModelAgentMemory } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentMemory.schema';
import { ModelAgentUpdate } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentUpdate.schema';
import { ModelAgentLog } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentLog.schema';
import { ModelUserApiKey } from '../../../../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../../../../utils/llm/llmCommonFunc';
import { getLlmConfig } from '../answerMachineShared/answerMachineGetLlmConfig';
import { agentTaskFilesDir, getAgentShellConfig } from './agentShellWorkspace';
import syncThreadUploadsToAgentWorkspace from './agentSyncUploads';
import writeAgentLog from './agentWriteLog';
import { defaultAgentToolRegistry, writeUpdate } from './agentToolRegistry';
import {
    formatMemorySummary,
    planAgentStep,
    synthesizeAgentAnswer,
    verifyAgentStep,
} from './agentPlanVerify';
import {
    formatActiveSkillsBlock,
    listEnabledSkillsForUser,
    resolveSkillsToLoad,
} from './agentSkillsLib';

/**
 * Complete current goal with a synthesized final answer posted to chat.
 */
const completeGoalWithAnswer = async (params: {
    agent: {
        _id: mongoose.Types.ObjectId;
        userId: mongoose.Types.ObjectId;
        threadId: mongoose.Types.ObjectId;
    };
    currentGoal: IAgentGoal;
    tickNumber: number;
    answer: string;
    llmConfig: NonNullable<Awaited<ReturnType<typeof getLlmConfig>>>;
}) => {
    const { agent, currentGoal, tickNumber, answer, llmConfig } = params;

    currentGoal.status = 'completed';
    currentGoal.result = answer.slice(0, 8000);
    currentGoal.completedAtUtc = new Date();
    currentGoal.updatedAtUtc = new Date();
    await currentGoal.save();

    await ModelAgentMemory.create({
        agentInstanceId: agent._id,
        userId: agent.userId,
        threadId: agent.threadId,
        key: `goal_${currentGoal.orderIndex}_result`,
        content: currentGoal.result,
        memoryType: 'result',
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });

    await writeUpdate({
        agentInstanceId: agent._id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'synthesize',
        message: `Synthesized final answer for: ${currentGoal.title}`,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
        payload: { answerLength: answer.length },
    });

    await writeUpdate({
        agentInstanceId: agent._id,
        userId: agent.userId,
        threadId: agent.threadId,
        updateType: 'goal_completed',
        message: `Completed goal: ${currentGoal.title}`,
        goalId: currentGoal._id as mongoose.Types.ObjectId,
        tickNumber,
        payload: { result: currentGoal.result },
    });

    await ModelChatLlm.create({
        type: 'text',
        content: answer,
        userId: agent.userId.toString(),
        threadId: agent.threadId,
        isAi: true,
        tags: ['agent', 'final_answer'],
        aiModelProvider: llmConfig.provider || '',
        aiModelName: llmConfig.model || '',
        createdAtUtc: new Date(),
        updatedAtUtc: new Date(),
    });
};

/**
 * Executes a single tick step for a running Agent instance.
 * Flow: plan → (tool | synthesize) → verify → optional synthesize.
 * Does NOT call Answer Machine.
 */
export const agentProcessTick = async (agentInstanceId: mongoose.Types.ObjectId | string): Promise<void> => {
    const now = new Date();

    let agent = await ModelAgentInstance.findOneAndUpdate(
        {
            _id: agentInstanceId,
            status: 'pending',
            statusIsRunning: false,
            cancellationRequestedUtc: null,
        },
        {
            $set: {
                statusIsRunning: true,
                updatedAtUtc: now,
            },
        },
        { new: true }
    );

    if (!agent) {
        return;
    }

    try {
        if (agent.cancellationRequestedUtc) {
            await ModelAgentInstance.findByIdAndUpdate(agent._id, {
                $set: {
                    status: 'failed',
                    statusIsRunning: false,
                    updatedAtUtc: new Date(),
                },
            });
            await writeUpdate({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'status',
                message: 'Agent stopped upon user request.',
                tickNumber: agent.tickCount || 0,
            });
            await writeAgentLog({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                action: 'agent_stopped',
                message: 'Agent stopped upon user request.',
                tickNumber: agent.tickCount || 0,
            });
            return;
        }

        const goals = await ModelAgentGoal.find({
            agentInstanceId: agent._id,
        }).sort({ orderIndex: 1 });

        const currentGoal = goals.find((g) => g.status === 'in_progress' || g.status === 'pending');

        if (!currentGoal) {
            const completedCount = goals.filter((g) => g.status === 'completed').length;
            const summary = `Completed ${completedCount} of ${goals.length} goals.`;
            await ModelAgentInstance.findByIdAndUpdate(agent._id, {
                $set: {
                    status: 'success',
                    statusIsRunning: false,
                    summary: summary.slice(0, 4000),
                    tickCount: agent.tickCount || 0,
                    lastTickAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                },
            });
            await writeUpdate({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'status',
                message: 'All goals completed. Agent finished.',
                tickNumber: agent.tickCount || 0,
            });
            await writeAgentLog({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                action: 'agent_completed',
                message: 'All goals completed. Agent finished.',
                tickNumber: agent.tickCount || 0,
                payload: { summary },
            });
            return;
        }

        const tickNumber = (agent.tickCount || 0) + 1;

        if (currentGoal.status === 'pending') {
            currentGoal.status = 'in_progress';
            currentGoal.updatedAtUtc = new Date();
            await currentGoal.save();

            await writeUpdate({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'goal_started',
                message: `Started goal: ${currentGoal.title}`,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
            });
            await writeAgentLog({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                action: 'goal_started',
                title: `Started goal: ${currentGoal.title}`,
                message: `Started goal: ${currentGoal.title}`,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
            });
        }

        await writeUpdate({
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'tick',
            message: `Tick ${tickNumber} started`,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
        });

        // 1. Past 10 Messages
        const recentChatDocs = await ModelChatLlm.find({ threadId: agent.threadId })
            .sort({ createdAtUtc: -1 })
            .limit(10);
        const past10Messages = recentChatDocs.reverse().map((m) => ({
            role: m.isAi ? 'assistant' : 'user',
            content: m.content.slice(0, 1000),
            createdAt: m.createdAtUtc,
        }));

        // 2. Past Goal Results
        const pastGoalResults = goals.map((g) => ({
            orderIndex: g.orderIndex,
            title: g.title,
            status: g.status,
            result: g.result || '(none)',
        }));

        // 3. Last 50 Logs
        const recentLogDocs = await ModelAgentLog.find({ agentInstanceId: agent._id })
            .sort({ createdAtUtc: -1 })
            .limit(50);
        const last50Logs = recentLogDocs.reverse().map((l) => ({
            tick: l.tickNumber,
            action: l.action,
            title: l.title,
            message: l.message.slice(0, 400),
            level: l.level,
        }));

        // 4. Runtime sync of user uploaded files
        const logCtx = {
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
        };

        await syncThreadUploadsToAgentWorkspace({
            userId: agent.userId,
            threadId: agent.threadId,
            logCtx,
        });

        // 5. Dynamic shell listing
        const agentShellDir = agentTaskFilesDir(String(agent.threadId));
        let shellWorkspaceListing: {
            relativePath: string;
            pathInAgentFolder?: string;
            absolutePath: string;
            isDir: boolean;
            size: number;
        }[] = [];
        let containerWorkingDir = '/app/data/ai-notes-xyz-shell-files';
        let agentFolderAbsolutePath = `/app/data/${agentShellDir}`;

        try {
            const apiKeyDoc = await ModelUserApiKey.findOne({ userId: agent.userId });
            if (apiKeyDoc) {
                const apiKey = getApiKeyByObject(apiKeyDoc);
                const shell = getAgentShellConfig(apiKey);
                if (shell) {
                    const shellRes = await axios.get(
                        `${shell.baseUrl.replace(/\/+$/, '')}/api/shell-engine/file/list`,
                        {
                            params: { relativeDir: agentShellDir, maxFiles: 1000 },
                            timeout: 10_000,
                            headers: { 'X-API-Token': shell.token },
                            validateStatus: () => true,
                        }
                    );
                    if (shellRes.status === 200 && shellRes.data && typeof shellRes.data === 'object') {
                        const body = shellRes.data as Record<string, unknown>;
                        const rawList = body.files;
                        if (Array.isArray(rawList)) {
                            shellWorkspaceListing = rawList
                                .map((item) => {
                                    if (!item || typeof item !== 'object') return null;
                                    const o = item as Record<string, unknown>;
                                    const rel =
                                        typeof o.relativePath === 'string' ? o.relativePath.replace(/\\/g, '/') : '';
                                    if (!rel) return null;

                                    if (/\b(node_modules|\.git)\b/i.test(rel) || /package-lock\.json$/i.test(rel)) {
                                        return null;
                                    }

                                    const abs =
                                        typeof o.absolutePath === 'string' && o.absolutePath.trim()
                                            ? o.absolutePath.replace(/\\/g, '/')
                                            : `/app/data/${rel}`;

                                    if (abs.includes('/agent/')) {
                                        const idx = abs.indexOf('/agent/');
                                        containerWorkingDir = abs.slice(0, idx);
                                        agentFolderAbsolutePath = abs.slice(
                                            0,
                                            idx + `/agent/${agent.threadId}`.length
                                        );
                                    } else if (abs.includes('/ai-notes-xyz-shell-files/')) {
                                        const idx = abs.indexOf('/ai-notes-xyz-shell-files/');
                                        containerWorkingDir = abs.slice(
                                            0,
                                            idx + '/ai-notes-xyz-shell-files'.length
                                        );
                                    }

                                    const folderIdx = rel.indexOf(`${agentShellDir}/`);
                                    const pathInAgentFolder =
                                        folderIdx !== -1 ? rel.slice(folderIdx + agentShellDir.length + 1) : rel;

                                    return {
                                        relativePath: rel,
                                        pathInAgentFolder,
                                        absolutePath: abs,
                                        isDir: Boolean(o.isDir),
                                        size: typeof o.size === 'number' ? o.size : 0,
                                    };
                                })
                                .filter((i): i is NonNullable<typeof i> => i !== null);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to fetch dynamic shell file structure for tick:', e);
        }

        const memories = await ModelAgentMemory.find({
            agentInstanceId: agent._id,
        })
            .sort({ createdAtUtc: -1 })
            .limit(25);

        const recentUpdates = await ModelAgentUpdate.find({
            agentInstanceId: agent._id,
        })
            .sort({ createdAtUtc: -1 })
            .limit(12);

        const llmConfig = await getLlmConfig({ threadId: agent.threadId });
        if (!llmConfig) {
            throw new Error('No LLM config available for agent tick');
        }

        const memorySummary = formatMemorySummary(
            memories.map((m) => ({ key: m.key, memoryType: m.memoryType, content: m.content }))
        );
        const recentToolSummary = recentUpdates
            .map((u) => `- [${u.updateType}] ${u.message}`)
            .join('\n')
            .slice(0, 4000);
        const recentNoopCount = recentUpdates.filter(
            (u) => typeof u.message === 'string' && /\bnoop\b/i.test(u.message)
        ).length;

        // Force synthesize on late ticks with some evidence, or too many noops
        const forceSynthesize =
            recentNoopCount >= 2 || (tickNumber >= 8 && memories.length > 0) || tickNumber >= 12;

        const skillBodies = await listEnabledSkillsForUser(agent.userId);
        const skillsCatalog = skillBodies.map((s) => ({ name: s.name, description: s.description }));
        let activeSkillsBlock = '';
        let activeSkillNames: string[] = Array.isArray(agent.activeSkillNames)
            ? [...agent.activeSkillNames]
            : [];

        // ——— PLAN ———
        let plan = forceSynthesize
            ? {
                  kind: 'synthesize' as const,
                  reason:
                      tickNumber >= 12
                          ? 'Max ticks reached; synthesizing best answer'
                          : recentNoopCount >= 2
                            ? 'Too many noops; synthesizing'
                            : 'Enough ticks with evidence; synthesizing',
                  skillsToLoad: activeSkillNames,
              }
            : await planAgentStep({
                  logCtx,
                  llmConfig,
                  toolDescriptions: defaultAgentToolRegistry.getToolDescriptions(),
                  goalTitle: currentGoal.title,
                  goalDescription: currentGoal.description || currentGoal.title,
                  memorySummary,
                  recentToolSummary: [
                      recentToolSummary,
                      `recentLogs: ${JSON.stringify(last50Logs.slice(-15)).slice(0, 2000)}`,
                      `pastGoals: ${JSON.stringify(pastGoalResults).slice(0, 1500)}`,
                      `shellFiles: ${shellWorkspaceListing.length}`,
                      `workspace: ${agentFolderAbsolutePath || `${containerWorkingDir}/agent/${agent.threadId}`}`,
                  ].join('\n'),
                  tickNumber,
                  recentNoopCount,
                  skillsCatalog,
                  activeSkillsBlock: formatActiveSkillsBlock(
                      resolveSkillsToLoad(skillBodies, activeSkillNames)
                  ),
              });

        // Resolve skills from this plan turn
        const prevSkillNames = [...activeSkillNames];
        const loadedSkills = resolveSkillsToLoad(skillBodies, plan.skillsToLoad);
        if (loadedSkills.length > 0) {
            activeSkillNames = Array.from(
                new Set([...activeSkillNames, ...loadedSkills.map((s) => s.name)])
            ).slice(0, 6);
            activeSkillsBlock = formatActiveSkillsBlock(
                resolveSkillsToLoad(skillBodies, activeSkillNames)
            );
            const skillsChanged =
                activeSkillNames.length !== prevSkillNames.length ||
                activeSkillNames.some((n) => !prevSkillNames.includes(n));
            if (skillsChanged) {
                await ModelAgentInstance.findByIdAndUpdate(agent._id, {
                    $set: { activeSkillNames, updatedAtUtc: new Date() },
                });
                await writeUpdate({
                    agentInstanceId: agent._id as mongoose.Types.ObjectId,
                    userId: agent.userId,
                    threadId: agent.threadId,
                    updateType: 'skills_loaded',
                    message: `Skills loaded: ${activeSkillNames.join(', ')}`,
                    goalId: currentGoal._id as mongoose.Types.ObjectId,
                    tickNumber,
                    payload: { skills: activeSkillNames },
                });
            }
        } else if (activeSkillNames.length > 0) {
            activeSkillsBlock = formatActiveSkillsBlock(
                resolveSkillsToLoad(skillBodies, activeSkillNames)
            );
        }

        // First tick with no memory: bias toward multi-domain search for personal questions
        if (
            plan.kind === 'synthesize' &&
            memories.length === 0 &&
            tickNumber <= 2 &&
            !forceSynthesize
        ) {
            plan = {
                kind: 'action',
                action: 'search_all_domains',
                query: currentGoal.description || currentGoal.title,
                reason: 'No evidence yet — search personal domains first',
                skillsToLoad: plan.skillsToLoad || ['personal-research'],
            };
        }

        await writeUpdate({
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'plan',
            message:
                plan.kind === 'synthesize'
                    ? `Plan: synthesize — ${plan.reason}`
                    : `Plan: ${plan.action}${plan.reason ? ` — ${plan.reason}` : ''}`,
            goalId: currentGoal._id as mongoose.Types.ObjectId,
            tickNumber,
            payload: { plan, activeSkillNames },
        });

        const runSynthesize = async (reason: string) => {
            const freshMemories = await ModelAgentMemory.find({ agentInstanceId: agent._id })
                .sort({ createdAtUtc: -1 })
                .limit(30);
            const answer = await synthesizeAgentAnswer({
                logCtx,
                llmConfig,
                goalTitle: currentGoal.title,
                goalDescription: currentGoal.description || currentGoal.title,
                memorySummary: formatMemorySummary(
                    freshMemories.map((m) => ({
                        key: m.key,
                        memoryType: m.memoryType,
                        content: m.content,
                    }))
                ),
                pastChatSummary: past10Messages
                    .map((m) => `${m.role}: ${m.content}`)
                    .join('\n')
                    .slice(0, 3000),
                activeSkillsBlock,
            });

            await completeGoalWithAnswer({
                agent: {
                    _id: agent._id as mongoose.Types.ObjectId,
                    userId: agent.userId,
                    threadId: agent.threadId,
                },
                currentGoal,
                tickNumber,
                answer,
                llmConfig,
            });

            await writeAgentLog({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                action: 'synthesize',
                message: reason,
                tickNumber,
                payload: { answerLength: answer.length },
            });
        };

        if (plan.kind === 'synthesize') {
            await runSynthesize(plan.reason);
        } else {
            const toolArgs: Record<string, unknown> = {
                action: plan.action,
                query: plan.query,
                memoryKey: plan.memoryKey,
                memoryContent: plan.memoryContent,
                memoryType: plan.memoryType,
                message: plan.message,
                code: plan.code,
                scriptType: plan.scriptType,
                fileName: plan.fileName,
                reason: plan.reason,
            };

            const tool = defaultAgentToolRegistry.getTool(plan.action);
            let toolResultSummary = '';
            let toolSuccess = true;

            if (tool) {
                const result = await tool.execute(
                    {
                        agentInstanceId: agent._id as mongoose.Types.ObjectId,
                        userId: agent.userId,
                        threadId: agent.threadId,
                        currentGoal,
                        memories,
                        recentUpdates,
                        tickNumber,
                        llmConfig,
                        logCtx,
                    },
                    toolArgs
                );
                toolResultSummary = result.resultSummary || '';
                toolSuccess = result.success;
            } else {
                const fallbackTool = defaultAgentToolRegistry.getTool('noop');
                if (fallbackTool) {
                    await fallbackTool.execute(
                        {
                            agentInstanceId: agent._id as mongoose.Types.ObjectId,
                            userId: agent.userId,
                            threadId: agent.threadId,
                            currentGoal,
                            memories,
                            recentUpdates,
                            tickNumber,
                            llmConfig,
                            logCtx,
                        },
                        { reason: `Unrecognized action: ${plan.action}` }
                    );
                }
                toolResultSummary = `Unrecognized action: ${plan.action}`;
                toolSuccess = false;
            }

            // ——— VERIFY ———
            const freshForVerify = await ModelAgentMemory.find({ agentInstanceId: agent._id })
                .sort({ createdAtUtc: -1 })
                .limit(25);
            const verify = await verifyAgentStep({
                logCtx,
                llmConfig,
                goalTitle: currentGoal.title,
                goalDescription: currentGoal.description || currentGoal.title,
                lastAction: plan.action,
                lastResultSummary: toolResultSummary,
                memorySummary: formatMemorySummary(
                    freshForVerify.map((m) => ({
                        key: m.key,
                        memoryType: m.memoryType,
                        content: m.content,
                    }))
                ),
                activeSkillsBlock,
            });

            await writeUpdate({
                agentInstanceId: agent._id as mongoose.Types.ObjectId,
                userId: agent.userId,
                threadId: agent.threadId,
                updateType: 'verify',
                message: `Verify: ${verify.verdict}${verify.reason ? ` — ${verify.reason}` : ''}`,
                goalId: currentGoal._id as mongoose.Types.ObjectId,
                tickNumber,
                payload: { ...verify, toolSuccess },
            });

            if (verify.verdict === 'retry' && verify.retryHint) {
                await ModelAgentMemory.create({
                    agentInstanceId: agent._id,
                    userId: agent.userId,
                    threadId: agent.threadId,
                    key: `retry_hint_${tickNumber}`,
                    content: verify.retryHint,
                    memoryType: 'plan',
                    createdAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                });
            }

            if (verify.verdict === 'ready_to_synthesize' || (forceSynthesize && freshForVerify.length > 0)) {
                await runSynthesize(verify.reason || 'Verifier approved synthesis');
            }
        }

        await ModelAgentInstance.findByIdAndUpdate(agent._id, {
            $set: {
                tickCount: tickNumber,
                statusIsRunning: false,
                lastTickAtUtc: new Date(),
                updatedAtUtc: new Date(),
            },
        });
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await ModelAgentInstance.findByIdAndUpdate(agent._id, {
            $set: {
                status: 'failed',
                statusIsRunning: false,
                errorReason: errMsg.slice(0, 1000),
                updatedAtUtc: new Date(),
            },
        });
        await writeUpdate({
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            updateType: 'error',
            message: `Agent tick error: ${errMsg}`,
            tickNumber: agent.tickCount || 0,
        });
        await writeAgentLog({
            agentInstanceId: agent._id as mongoose.Types.ObjectId,
            userId: agent.userId,
            threadId: agent.threadId,
            action: 'agent_error',
            message: errMsg,
            level: 'error',
            tickNumber: agent.tickCount || 0,
        });
    }
};

export default agentProcessTick;
