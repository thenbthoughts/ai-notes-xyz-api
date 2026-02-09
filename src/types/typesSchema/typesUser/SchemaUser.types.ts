import mongoose, { Document } from 'mongoose';

// User Interface
interface IUser extends Document {
    username: string;
    password: string;

    // personal info
    name: string;
    dateOfBirth: string;
    profilePictureLink: string;
    bio: string;
    languages: string[];

    // location
    city: string;
    state: string;
    country: string;
    zipCode: string;

    // email
    email: string;
    emailVerified: boolean;

    // 
    phoneNumber: string;
    address: string;
    website: string;

    // timezone
    timeZoneRegion: string;
    timeZoneUtcOffset: number;

    // enabled ai features
    featureAiActionsEnabled: boolean;
    featureAiActionsModelProvider: '' | 'groq' | 'openrouter' | 'ollama' | 'openai-compatible';
    featureAiActionsModelName: string;

    featureAiActionsChatThread: boolean;
    featureAiActionsChatMessage: boolean;
    featureAiActionsNotes: boolean;
    featureAiActionsTask: boolean;
    featureAiActionsLifeEvents: boolean;
    featureAiActionsInfoVault: boolean;

    // memory limit
    memoryLimit: number;
}

export default IUser;