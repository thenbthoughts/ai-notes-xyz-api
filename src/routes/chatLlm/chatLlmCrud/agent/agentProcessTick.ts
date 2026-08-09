import mongoose from 'mongoose';

import {
    agentTickClaim,
    agentTickFail,
    agentTickFinishIfDone,
    agentTickHandleCancel,
    agentTickPlan,
    agentTickPrepareGoal,
    agentTickRelease,
    agentTickRunTool,
    agentTickSynthesize,
    agentTickVerify,
} from './agentTickSteps';

/**
 * Executes a single isolated tick for an agent run.
 * Only input: agent run `_id`. Each step reloads state from MongoDB.
 * Flow: claim → cancel? → done? → prepare → plan → (synthesize | tool → verify → synthesize?) → release
 */
export const agentProcessTick = async (
    agentInstanceId: mongoose.Types.ObjectId | string
): Promise<void> => {
    const claimed = await agentTickClaim(agentInstanceId);
    if (!claimed) {
        return;
    }

    try {
        if (await agentTickHandleCancel(agentInstanceId)) {
            return;
        }

        if (await agentTickFinishIfDone(agentInstanceId)) {
            return;
        }

        await agentTickPrepareGoal(agentInstanceId);

        const planKind = await agentTickPlan(agentInstanceId);

        if (planKind === 'synthesize') {
            await agentTickSynthesize(agentInstanceId, 'Planner ready to synthesize');
        } else {
            await agentTickRunTool(agentInstanceId);
            const verdict = await agentTickVerify(agentInstanceId);
            if (verdict === 'ready_to_synthesize') {
                await agentTickSynthesize(agentInstanceId, 'Verifier approved synthesis');
            }
        }

        // If last goal just completed, finish the run now (isolated check)
        if (await agentTickFinishIfDone(agentInstanceId)) {
            return;
        }

        await agentTickRelease(agentInstanceId);
    } catch (err) {
        await agentTickFail(agentInstanceId, err);
    }
};

export default agentProcessTick;
