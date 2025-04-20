import { Document } from 'mongoose';

export interface tsSchemaAiModelList extends Document {
    modelName: string;
    modelType: string;
    provider: string;
};