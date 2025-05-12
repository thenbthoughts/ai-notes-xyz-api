import mongoose, { Document } from 'mongoose';

// LifeEvents
export interface ILifeEventCategory extends Document {
    // identification
    username: string;

    // fields
    name: string;
    isSubCategory: boolean;
    parentId: mongoose.Schema.Types.ObjectId | null;
    
    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
};