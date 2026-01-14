import { Document } from 'mongoose';

// Chat Interface
export interface tsSchemaAiModelListOllama extends Document {
    // ai
    username: string;
    modelLabel: string;
    modelName: string;

    // raw
    raw: object;
};