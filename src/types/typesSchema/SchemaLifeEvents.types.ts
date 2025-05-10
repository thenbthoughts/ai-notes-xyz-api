import { Document } from 'mongoose';

// LifeEvents
export interface ILifeEvents extends Document {
    // identification
    username: string;

    // fields
    title: string;
    description: string;
    categoryUniqueKey: string;
    categorySubUniqueKey: string;
    isStarred: boolean;
    eventImpact: string;
    tags: string[];

    // identification - pagination
    eventDateUtc: Date;
    eventDateYearStr: string;
    eventDateYearMonthStr: string;

    // ai
    aiSummary: string;
    aiTags: string[];
    aiSuggestions: string;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
};