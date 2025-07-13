import { Document } from 'mongoose';

// Chat Interface
export interface tsSchemaAiModelListOpenrouter extends Document {
    // identification
    id: string;

    // ai
    name: string;
    description: string;
};