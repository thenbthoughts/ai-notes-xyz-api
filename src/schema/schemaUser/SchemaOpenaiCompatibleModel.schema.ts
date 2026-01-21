import mongoose, { Schema } from 'mongoose';
import IOpenaiCompatibleModel from '../../types/typesSchema/typesUser/SchemaOpenaiCompatibleModel.types';

const openaiCompatibleModelSchema = new Schema<IOpenaiCompatibleModel>({
    username: { type: String, required: true, default: '', index: true },
    providerName: { type: String, default: '' },
    baseUrl: { type: String, required: true, default: '' },
    apiKey: { type: String, required: true, default: '' },
    modelName: { type: String, default: '' },
    customHeaders: { type: String, default: '' },
    createdAtUtc: { type: Date, default: Date.now },
    updatedAtUtc: { type: Date, default: Date.now },
    // input modalities
    isInputModalityText: { type: String, default: 'false' },
    isInputModalityImage: { type: String, default: 'false' },
    isInputModalityAudio: { type: String, default: 'false' },
    isInputModalityVideo: { type: String, default: 'false' },
    // output modalities
    isOutputModalityText: { type: String, default: 'false' },
    isOutputModalityImage: { type: String, default: 'false' },
    isOutputModalityAudio: { type: String, default: 'false' },
    isOutputModalityVideo: { type: String, default: 'false' },
});

const ModelOpenaiCompatibleModel = mongoose.model<IOpenaiCompatibleModel>(
    'openaiCompatibleModel',
    openaiCompatibleModelSchema,
    'openaiCompatibleModel'
);

export {
    ModelOpenaiCompatibleModel
};
