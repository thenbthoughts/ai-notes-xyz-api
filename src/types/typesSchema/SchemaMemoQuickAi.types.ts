import { Document } from 'mongoose';

export interface tsMemoQuickAi extends Document{
    // auth
    username: string;

    // note properties
    title: string;
    content: string;
    color: string;
    labels: string[];
    labelsAi: string[];
    isPinned: boolean;
    shouldSentToAI: boolean;
    position: number;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
}
