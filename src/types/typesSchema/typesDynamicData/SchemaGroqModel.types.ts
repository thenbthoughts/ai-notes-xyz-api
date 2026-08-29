import { Document } from 'mongoose';

// Chat Interface
export interface tsSchemaAiModelListGroq extends Document {
    // identification
    id: string;

    // fields
    object: string;
    created: number;
    owned_by: string;
    active: boolean;
    context_window: number;
    contextLength: number;
    maxCompletionTokens: number;

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

    // raw
    raw?: object;
};