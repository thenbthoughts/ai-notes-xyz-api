import { Document } from 'mongoose';

// Chat Interface
export interface tsSchemaAiModelListLocalai extends Document {
    // ai
    username: string;
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

    // raw
    raw: object;
};