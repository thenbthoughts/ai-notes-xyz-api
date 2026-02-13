import mongoose, { Schema } from 'mongoose';
import IUser from '../../types/typesSchema/typesUser/SchemaUser.types';

// User Schema
const userSchema = new Schema<IUser>({
    username: { type: String, required: true, unique: true, lowercase: true },
    password: {
        type: String,
        required: true,
        select: false,
    },

    // personal info
    name: {
        type: String,
        default: ''
        // info: name user
    },
    dateOfBirth: {
        type: String,
        default: ''
    },
    profilePictureLink: {
        type: String,
        default: ''
    },
    languages: {
        type: [String],
        default: []
    },
    bio: {
        type: String,
        default: ''
    },

    // email
    email: {
        type: String,
        default: ''
    },
    emailVerified: {
        type: Boolean,
        default: false
    },

    // location
    city: {
        type: String,
        default: ''
    },
    state: {
        type: String,
        default: ''
    },
    zipCode: {
        type: String,
        default: ''
    },
    country: {
        type: String,
        default: ''
    },

    // Time Zone
    timeZoneRegion: {
        type: String,
        default: 'Asia/Kolkata',
    },
    timeZoneUtcOffset: {
        type: Number,
        default: 330,
        // in minutes
    },

    // enabled ai features
    featureAiActionsEnabled: {
        type: Boolean,
        default: true,
    },
    featureAiActionsModelProvider: {
        type: String,
        enum: ['', 'groq', 'openrouter', 'ollama', 'openai-compatible'],
        default: '',
    },
    featureAiActionsModelName: {
        type: String,
        default: '',
    },

    featureAiActionsChatThread: {
        type: Boolean,
        default: true,
    },
    featureAiActionsChatMessage: {
        type: Boolean,
        default: true,
    },
    featureAiActionsNotes: {
        type: Boolean,
        default: true,
    },
    featureAiActionsTask: {
        type: Boolean,
        default: true,
    },
    featureAiActionsLifeEvents: {
        type: Boolean,
        default: true,
    },
    featureAiActionsInfoVault: {
        type: Boolean,
        default: true,
    },

    // memory settings
    isStoreUserMemoriesEnabled: {
        type: Boolean,
        default: true,
    },
    userMemoriesLimit: {
        type: Number,
        default: 25,
        // Note: This limit only applies to non-permanent memories. Permanent memories do not count towards this limit.
    },
});

// User Model
const ModelUser = mongoose.model<IUser>('user', userSchema, 'user');

export {
    ModelUser
};