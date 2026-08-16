import { Document } from 'mongoose';

// Chat Interface
export interface tsSchemaAiModelModality extends Document {
    // identification
    provider: string;
    modalIdString: string;

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

    contextLength: number;
    maxCompletionTokens: number;
};