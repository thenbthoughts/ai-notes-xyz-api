import { Document } from 'mongoose';

// Chat Interface
export interface tsSchemaAiModelListOpenrouter extends Document {
    // identification
    id: string;

    // ai
    name: string;
    description: string;
    contextLength: number;
    maxCompletionTokens: number;

    // raw
    raw?: object;

    // input modalities
    isInputModalityText: string;
    isInputModalityImage: string;
    isInputModalityAudio: string;
    isInputModalityVideo: string;

    // output modalities
    isOutputModalityText: string;
    isOutputModalityImage: string;
    isOutputModalityAudio: string;
    isOutputModalityVideo: string;
    isOutputModalityEmbedding: string;
};