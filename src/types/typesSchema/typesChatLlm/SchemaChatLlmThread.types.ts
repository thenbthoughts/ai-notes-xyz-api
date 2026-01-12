import { Document } from 'mongoose';

// Chat Interface
export interface IChatLlmThread extends Document {
    // fields
    threadTitle: string,

    // auto context
    isPersonalContextEnabled: boolean,
    isAutoAiContextSelectEnabled: boolean,
    systemPrompt: string,

    chatLlmTemperature: number,
    chatLlmMaxTokens: number,

    // classification
    isFavourite: boolean,

    // selected model
    aiModelName: string,
    aiModelProvider: string,

    // model info
    aiSummary: string;
    aiTasks: object[];
    tagsAi: string[];

    // auth
    username: string;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;
};