import { Document } from 'mongoose';

// InfoVault Entity
export interface IInfoVaultContact extends Document {
    // identification
    username: string;

    // basic information
    infoVaultType: string;
    infoVaultSubType: string;
    name: string; // Computed or custom display name
    nickname: string;
    photoUrl: string; // Profile picture/avatar URL

    // professional information
    company: string;
    jobTitle: string;
    department: string;

    // additional information
    notes: string; // Free-form notes about the contact

    // organization & categorization
    tags: string[]; // User-defined tags
    isFavorite: boolean; // Starred/favorite contact

    // relationship context
    relationshipType: 'myself' | 'personal' | 'professional' | 'family' | 'other';
    lastContactDate: Date; // Last time you communicated
    contactFrequency: '' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'rarely';

    // ai enhancement
    aiSummary: string; // AI-generated summary of the contact
    aiTags: string[]; // AI-suggested tags
    aiSuggestions: string; // AI suggestions for maintaining relationship

    // status & lifecycle
    isArchived: boolean; // Whether contact is archived
    isBlocked: boolean; // Blocked contact
    lastUpdatedBy: string; // Who last updated this contact

    // auto-generated fields
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}