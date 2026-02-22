import mongoose, { Schema } from 'mongoose';

import { IHomepageSummary } from '../../types/typesSchema/typesHomepageSummary/SchemaHomepageSummary.types';

// Homepage Summary Schema
const homepageSummarySchema = new Schema<IHomepageSummary>({
    // identification
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },

    // fields
    generatedAtUtc: {
        type: Date,
        required: true,
        default: null,
    },
    summary: {
        type: String,
        required: true,
        default: '',
    },
});

// Homepage Summary Model
const ModelHomepageSummary = mongoose.model<IHomepageSummary>(
    'homepageSummary',
    homepageSummarySchema,
    'homepageSummary'
);

export {
    ModelHomepageSummary
};