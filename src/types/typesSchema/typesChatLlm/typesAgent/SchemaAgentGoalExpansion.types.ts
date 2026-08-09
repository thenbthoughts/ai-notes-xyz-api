import mongoose, { Document } from 'mongoose';

/**
 * Structured expansion of an AgentGoal: how to judge success and what to produce.
 * Separate collection so goals stay lean and expansions can evolve independently.
 */
export interface IAgentGoalExpansion extends Document {
    _id: mongoose.Types.ObjectId;
    agentInstanceId: mongoose.Types.ObjectId;
    agentGoalId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    /** What the user should receive when this goal is done (free-form + hints). */
    outputFormat: string;
    /** Concrete expectations / checklist items for the planner and verifier. */
    expectations: string[];
    /** One-line success definition. */
    successCriteria: string;
    /** Short approach hint for the planner (not a hardcoded classifier). */
    suggestedApproach: string;
    suggestedSkills: string[];
    suggestedTools: string[];
    /** True when shell/scripts are needed to produce the output. */
    requiresShell: boolean;
    /** True when personal notes/tasks/memos/etc. should be searched. */
    requiresPersonalData: boolean;
    /** Extra acceptance checks used by verify (e.g. "PDF path printed", "cites ≥2 domains"). */
    acceptanceChecks: string[];
    createdAtUtc: Date;
    updatedAtUtc: Date;
}
