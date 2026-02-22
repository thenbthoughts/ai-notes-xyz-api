import mongoose, { Document } from 'mongoose';

// Homepage Summary Interface
export interface IHomepageSummary extends Document {
    // identification
    _id: mongoose.Types.ObjectId;

    // fields
    username: string;
    generatedAtUtc: Date;
    summary: string;
}