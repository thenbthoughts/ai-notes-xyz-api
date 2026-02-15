import mongoose, { Document } from 'mongoose';

// Chat Interface
export interface IChatLlmThread extends Document {
    // identification
    _id: mongoose.Types.ObjectId;

    // fields
    threadTitle: string;

    // auto context
    systemPrompt: string;

    chatLlmTemperature: number;
    chatLlmMaxTokens: number

    chatMemoryLimit: number;

    // classification
    isFavourite: boolean;

    // selected model
    aiModelName: string;
    aiModelProvider: string;
    aiModelOpenAiCompatibleConfigId: mongoose.Schema.Types.ObjectId | null;

    // model info
    aiSummary: string;
    aiTasks: object[];
    tagsAi: string[];

    // context
    isPersonalContextEnabled: boolean;
    isAutoAiContextSelectEnabled: boolean;
    isMemoryEnabled: boolean;

    // answer type
    answerEngine: 'conciseAnswer' | 'answerMachine';

    // answerEngine -> answerMachine
    answerMachineMinNumberOfIterations: number;
    answerMachineMaxNumberOfIterations: number;
    answerMachineUsedOpencode: boolean;
    answerMachineUsedWebSearch: boolean;

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