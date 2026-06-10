import { Document, Types } from 'mongoose';

// Chat Interface
export interface tsSchemaAiModelListOllama extends Document {
    // ai
    userId: string;
    modelLabel: string;
    modelName: string;

    // input modalities
    isInputModalityText: string;
    isInputModalityImage: string;
    isInputModalityAudio: string;
    isInputModalityVideo: string;

    // raw
    raw: object;
};