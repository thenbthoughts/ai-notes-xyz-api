import { Document, Types } from 'mongoose';

// Chat Interface
export interface tsSchemaAiModelListLocalai extends Document {
    // ai
    userId: Types.ObjectId;
    modelLabel: string;
    modelName: string;
    modelType: '' | 'llm' | 'stt' | 'tts' | 'embedding' | 'image-generation';

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

    // raw
    raw: object;
};