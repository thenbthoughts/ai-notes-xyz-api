import { Document, Types } from 'mongoose';

interface IDappsProject extends Document {
    userId: Types.ObjectId;
    name: string;
    slug: string;
    description: string;
    stackHint: 'auto' | 'static' | 'node' | 'python';
    port: number;
    basicAuthUsername: string;
    basicAuthPassword: string;
    manageToken: string;
    gitRepo: string;
    prodUrl: string;
    devUrl: string;
    prodStatus: 'pending' | 'building' | 'live' | 'failed';
    devStatus: 'pending' | 'building' | 'live' | 'failed';
    devLog: string;
    devBuiltAt: Date | null;
    coolifyAppUuidDev: string;
    coolifyAppUuidProd: string;
    starred: boolean;
}

export default IDappsProject;
