import mongoose, { Document } from 'mongoose';

// User Interface
interface IUser extends Document {
    _id: mongoose.Types.ObjectId;
    username: string;
    password: string;

    // convenience alias for the _id when we want to treat the user identifier as "userId"
    userId?: mongoose.Types.ObjectId;

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
    featureAiActionsModelProvider: '' | 'groq' | 'openrouter' | 'ollama' | 'localai' | 'openai-compatible';
    featureAiActionsModelName: string;

    featureAiActionsChatThread: boolean;
    featureAiActionsChatMessage: boolean;
    featureAiActionsNotes: boolean;
    featureAiActionsTask: boolean;
    featureAiActionsLifeEvents: boolean;
    featureAiActionsInfoVault: boolean;

    // memories limit
    isStoreUserMemoriesEnabled: boolean;
    userMemoriesLimit: number;
}

export default IUser;