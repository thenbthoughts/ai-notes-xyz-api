import { Document } from 'mongoose';

// Chat Interface
export interface tsSchemaAiModelListGroq extends Document {
    // identification
    id: string;

    // fields
    object: string;
    created: number;
    owned_by: string;
    active: boolean;
    context_window: number;
};