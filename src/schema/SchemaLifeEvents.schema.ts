import mongoose, { Schema } from 'mongoose';

import { ILifeEvents } from '../types/typesSchema/SchemaLifeEvents.types';

// LifeEvents Schema
const lifeEventsSchema = new Schema<ILifeEvents>({
    // identification
    username: { type: String, required: true, default: '', index: true },

    // fields
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    categorySubId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    isStar: { type: Boolean, default: false },
    eventImpact: {
        type: String,
        default: 'very-low',
        enum: [
            'very-low',
            'low',
            'medium',
            'large',
            'huge',
        ],
        /*
        values:
        1. very-low
        2. low
        3. medium
        4. large
        5. huge
        */
    },
    tags: { type: [String], default: [] },

    // identification - pagination
    eventDateUtc: { type: Date, required: true, default: null, index: true },
    eventDateYearStr: { type: String, required: true, default: '', index: true },
    eventDateYearMonthStr: { type: String, required: true, default: '', index: true },

    // ai
    aiSummary: { type: String, default: '' },
    aiTags: { type: [String], default: [] },
    aiSuggestions: { type: String, default: '' },
    aiCategory: { type: String, default: 'Other' },
    aiSubCategory: { type: String, default: 'Other' },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// LifeEvents Model
const ModelLifeEvents = mongoose.model<ILifeEvents>(
    'lifeEvents',
    lifeEventsSchema,
    'lifeEvents'
);

export {
    ModelLifeEvents
};