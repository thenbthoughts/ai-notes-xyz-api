import { Document } from 'mongoose';

// Chat Interface
export interface tsSchemaAiModelModality extends Document {
    // identification
    provider: string;
    modalIdString: string;

    // ai
    isInputModalityText: string;
    isInputModalityImage: string;
    isInputModalityAudio: string;
    isInputModalityVideo: string;
};