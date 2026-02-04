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
        default: false,
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
        default: false,
    },
    featureAiActionsChatMessage: {
        type: Boolean,
        default: false,
    },
    featureAiActionsNotes: {
        type: Boolean,
        default: false,
    },
    featureAiActionsTask: {
        type: Boolean,
        default: false,
    },
    featureAiActionsLifeEvents: {
        type: Boolean,
        default: false,
    },
    featureAiActionsInfoVault: {
        type: Boolean,
        default: false,
    },
});

// User Model
const ModelUser = mongoose.model<IUser>('user', userSchema, 'user');

export {
    ModelUser
};