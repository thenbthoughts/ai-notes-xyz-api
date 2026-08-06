import mongoose, { Schema } from 'mongoose';

import { IAgentSkill } from '../../../types/typesSchema/typesChatLlm/typesAgent/SchemaAgentSkill.types';

const agentSkillSchema = new Schema<IAgentSkill>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'user',
        default: null,
        index: true,
    },
    name: {
        type: String,
        required: true,
        maxlength: 64,
        index: true,
    },
    description: {
        type: String,
        required: true,
        maxlength: 1024,
        default: '',
    },
    body: {
        type: String,
        required: true,
        maxlength: 50_000,
        default: '',
    },
    enabled: {
        type: Boolean,
        default: true,
        index: true,
    },
    isBuiltin: {
        type: Boolean,
        default: false,
        index: true,
    },
    createdAtUtc: { type: Date, default: () => new Date() },
    updatedAtUtc: { type: Date, default: () => new Date() },
});

agentSkillSchema.index(
    { userId: 1, name: 1 },
    { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } }
);
agentSkillSchema.index(
    { name: 1, isBuiltin: 1 },
    { unique: true, partialFilterExpression: { isBuiltin: true, userId: null } }
);

const ModelAgentSkill = mongoose.model<IAgentSkill>('agentSkill', agentSkillSchema, 'agentSkill');

export { ModelAgentSkill };
