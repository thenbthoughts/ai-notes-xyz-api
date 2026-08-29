import { Document, Types } from 'mongoose';

// Chat Interface
export interface tsSchemaOllamaModelStoreModality extends Document {
    // ai
    userId: Types.ObjectId;
    modelName: string;

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