import mongoose, { Document } from 'mongoose';

// Homepage Summary Interface
export interface IHomepageSummary extends Document {
    // identification
    _id: mongoose.Types.ObjectId;

    // fields
    userId: mongoose.Types.ObjectId;
    generatedAtUtc: Date;
    summary: string;
}