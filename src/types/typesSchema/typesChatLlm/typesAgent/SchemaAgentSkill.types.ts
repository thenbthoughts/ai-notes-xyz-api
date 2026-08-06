import mongoose, { Document } from 'mongoose';

export interface IAgentSkill extends Document {
    _id: mongoose.Types.ObjectId;
    /** null for system builtins */
    userId: mongoose.Types.ObjectId | null;
    name: string;
    description: string;
    body: string;
    enabled: boolean;
    isBuiltin: boolean;
    createdAtUtc: Date;
    updatedAtUtc: Date;
}
