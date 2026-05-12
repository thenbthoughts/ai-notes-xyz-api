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

    // STT (Speech-to-Text)
    sttModelProvider: string;
    sttModelName: string;

    // TTS (Text-to-Speech)
    ttsModelProvider: string;
    ttsModelName: string;

    // model info
    aiSummary: string;
    aiTasks: object[];
    tagsAi: string[];

    // context
    isPersonalContextEnabled: boolean;
    isAutoAiContextSelectEnabled: boolean;
    isMemoryEnabled: boolean;

    // answer type
    answerEngine: 'conciseAnswer' | 'answerMachine4';

    // answerEngine -> answerMachine
    answerMachineMinNumberOfIterations: number;
    answerMachineMaxNumberOfIterations: number;
    answerMachineUsedOpencode: boolean;
    answerMachineUsedWebSearch: boolean;

    /** Cap sequential reasoning steps per AM3 iteration (Answer Machine 3 only). */
    answerMachineMaxReasoningStepsPerIteration?: number;

    /** Persisted on thread; older documents may omit this field */
    executeShell?: boolean;

    /** Inclusive attempt index start for each shell todo primary command (default 1). */
    shellExecuteMinAttempts?: number;
    /** Inclusive attempt index end for each shell todo primary command (default 3; max 10). */
    shellExecuteMaxAttempts?: number;

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