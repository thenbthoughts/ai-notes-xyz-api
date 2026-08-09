import mongoose, { Schema } from 'mongoose';

import { IAgentGoalExpansion } from '../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentGoalExpansion.types';

const agentGoalExpansionSchema = new Schema<IAgentGoalExpansion>({
    agentInstanceId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'agentInstance',
    },
    agentGoalId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        unique: true,
        index: true,
        ref: 'agentGoal',
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true,
    },
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'chatLlmThread',
    },
    outputFormat: { type: String, default: 'text_answer' },
    expectations: { type: [String], default: [] },
    successCriteria: { type: String, default: '' },
    suggestedApproach: { type: String, default: '' },
    suggestedSkills: { type: [String], default: [] },
    suggestedTools: { type: [String], default: [] },
    requiresShell: { type: Boolean, default: false },
    requiresPersonalData: { type: Boolean, default: false },
    acceptanceChecks: { type: [String], default: [] },
    createdAtUtc: { type: Date, default: () => new Date() },
    updatedAtUtc: { type: Date, default: () => new Date() },
});

agentGoalExpansionSchema.index({ agentInstanceId: 1, agentGoalId: 1 });

const ModelAgentGoalExpansion = mongoose.model<IAgentGoalExpansion>(
    'agentGoalExpansion',
    agentGoalExpansionSchema,
    'agentGoalExpansion'
);

export { ModelAgentGoalExpansion };
