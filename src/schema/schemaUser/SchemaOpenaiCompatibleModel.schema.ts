import mongoose, { Schema } from 'mongoose';
import IOpenaiCompatibleModel from '../../types/typesSchema/typesUser/SchemaOpenaiCompatibleModel.types';

const openaiCompatibleModelSchema = new Schema<IOpenaiCompatibleModel>({
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, index: true },
    providerName: { type: String, default: '' },
    baseUrl: { type: String, required: true, default: '' },
    apiKey: { type: String, required: true, default: '' },
    modelName: { type: String, default: '' },
    customHeaders: { type: String, default: '' },
    contextLength: { type: Number, default: 0 },
    maxCompletionTokens: { type: Number, default: 0 },
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
    isOutputModalityEmbedding: { type: String, default: 'false' },
});

const ModelOpenaiCompatibleModel = mongoose.model<IOpenaiCompatibleModel>(
    'openaiCompatibleModel',
    openaiCompatibleModelSchema,
    'openaiCompatibleModel'
);

export {
    ModelOpenaiCompatibleModel
};
