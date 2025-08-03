import mongoose, { Schema } from 'mongoose';
import IUser from '../types/typesSchema/SchemaUser.types';

// User Schema
const userSchema = new Schema<IUser>({
    username: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },

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

    // preferredModel
    preferredModelProvider: {
        type: String,
        default: ''

        // groq, openrouter, custom
    },
    preferredModelName: {
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
});

// User Model
const ModelUser = mongoose.model<IUser>('user', userSchema, 'user');

export {
    ModelUser
};