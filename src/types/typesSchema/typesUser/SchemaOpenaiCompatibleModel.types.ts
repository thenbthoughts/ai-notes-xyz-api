import mongoose, { Document } from 'mongoose';

interface IOpenaiCompatibleModel extends Document {
    _id: mongoose.Types.ObjectId;

    userId: mongoose.Types.ObjectId;
    providerName?: string;
    baseUrl: string;
    apiKey: string;
    modelName: string;
    customHeaders?: string;
    contextLength?: number;
    maxCompletionTokens?: number;
    createdAtUtc?: Date;
    updatedAtUtc?: Date;

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
}

export default IOpenaiCompatibleModel;
