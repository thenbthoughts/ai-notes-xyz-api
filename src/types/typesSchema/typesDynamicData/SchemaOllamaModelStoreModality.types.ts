import { Document, Types } from 'mongoose';

// Chat Interface
export interface tsSchemaOllamaModelStoreModality extends Document {
    // ai
    userId: string;
    modelName: string;

    // input modalities
    isInputModalityText: string;
    isInputModalityImage: string;
    isInputModalityAudio: string;
    isInputModalityVideo: string;
};