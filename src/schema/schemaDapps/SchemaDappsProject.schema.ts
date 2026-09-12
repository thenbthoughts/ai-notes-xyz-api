import mongoose, { Schema } from 'mongoose';
import IDappsProject from '../../types/typesSchema/typesDapps/SchemaDappsProject.types';

const dappsProjectSchema = new Schema<IDappsProject>({
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    description: { type: String, default: '' },
    stackHint: { type: String, enum: ['auto', 'static', 'node', 'python'], default: 'auto' },
    port: { type: Number, default: 3000 },
    basicAuthUsername: { type: String, default: '' },
    basicAuthPassword: { type: String, default: '' },
    manageToken: { type: String, default: '' },
    gitRepo: { type: String, default: '' },
    prodUrl: { type: String, default: '' },
    devUrl: { type: String, default: '' },
    prodStatus: { type: String, enum: ['pending', 'building', 'live', 'failed'], default: 'pending' },
    devStatus: { type: String, enum: ['pending', 'building', 'live', 'failed'], default: 'pending' },
    devLog: { type: String, default: '' },
    devBuiltAt: { type: Date, default: null },
    coolifyAppUuidDev: { type: String, default: '' },
    coolifyAppUuidProd: { type: String, default: '' },
    starred: { type: Boolean, default: false },
}, { timestamps: true });

dappsProjectSchema.index({ userId: 1, slug: 1 }, { unique: true });

const ModelDappsProject = mongoose.model<IDappsProject>(
    'dappsProject',
    dappsProjectSchema,
    'dappsProject'
);

export {
    ModelDappsProject
};
