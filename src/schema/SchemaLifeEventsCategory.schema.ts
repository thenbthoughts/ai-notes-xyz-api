import mongoose, { Schema } from 'mongoose';

import { ILifeEventCategory } from '../types/typesSchema/SchemaLifeEventCategory.types';

// LifeEvents Schema
const lifeEventCategorySchema = new Schema<ILifeEventCategory>({
    // identification
    username: { type: String, required: true, default: '', index: true },

    // fields
    name: { type: String, default: '' },
    isSubCategory: { type: Boolean, default: false },
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },

    // auto
    createdAtUtc: { type: Date, default: null },
    createdAtIpAddress: { type: String, default: '' },
    createdAtUserAgent: { type: String, default: '' },
    updatedAtUtc: { type: Date, default: null },
    updatedAtIpAddress: { type: String, default: '' },
    updatedAtUserAgent: { type: String, default: '' },
});

// LifeEvents Model
const ModelLifeEventCategory = mongoose.model<ILifeEventCategory>(
    'lifeEventCategory',
    lifeEventCategorySchema,
    'lifeEventCategory'
);

export {
    ModelLifeEventCategory
};