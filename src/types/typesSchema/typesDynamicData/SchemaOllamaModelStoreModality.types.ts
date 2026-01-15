import { Document } from 'mongoose';

// Chat Interface
export interface tsSchemaOllamaModelStoreModality extends Document {
    // ai
    username: string;
    modelName: string;

    // input modalities
    isInputModalityText: string;
    isInputModalityImage: string;
    isInputModalityAudio: string;
    isInputModalityVideo: string;
};