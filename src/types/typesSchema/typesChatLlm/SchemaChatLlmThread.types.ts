import mongoose, { Document } from 'mongoose';

// Chat Interface
export interface IChatLlmThread extends Document {
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

    // answer type
    answerEngine: 'conciseAnswer' | 'answerMachine';

    // answerEngine -> answerMachine
    answerMachineStatus: 'pending' | 'answered' | 'error';
    answerMachineErrorReason: string;
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