import mongoose, { Document } from 'mongoose';

interface IOpenaiCompatibleModel extends Document {
    _id: mongoose.Types.ObjectId;

    username: string;
    providerName?: string;
    baseUrl: string;
    apiKey: string;
    modelName: string;
    customHeaders?: string;
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
}

export default IOpenaiCompatibleModel;
