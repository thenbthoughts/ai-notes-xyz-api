import { Document } from 'mongoose';

// Chat Interface
export interface tsSchemaAiModelListLocalai extends Document {
    // ai
    username: string;
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