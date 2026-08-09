/**
 * @deprecated Prefer agentBrain/runBrainTick — thin wrapper kept for imports.
 * WORK tick now maps to one brain cycle (tool + observe path only).
 */
import mongoose from 'mongoose';
import { runBrainTick } from '../agentBrain/runBrainTick';

export type WorkTickResult = {
    brainStep: 'plan' | 'done';
};

export const runWorkTick = async (
    agentInstanceId: mongoose.Types.ObjectId | string
): Promise<WorkTickResult> => {
    await runBrainTick(agentInstanceId);
    return { brainStep: 'plan' };
};

export default runWorkTick;
