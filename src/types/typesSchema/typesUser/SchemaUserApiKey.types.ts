import { Document } from 'mongoose';

interface IUserApiKey extends Document {
    username: string;

    // client frontend url
    clientFrontendUrl: string;

    // apikey - groq
    apiKeyGroqValid: boolean;
    apiKeyGroq: string;

    // apikey - openrouter
    apiKeyOpenrouterValid: boolean;
    apiKeyOpenrouter: string;

    // apikey - s3
    apiKeyS3Valid: boolean;
    apiKeyS3Endpoint: string,
    apiKeyS3Region: string,
    apiKeyS3AccessKeyId: string,
    apiKeyS3SecretAccessKey: string,
    apiKeyS3BucketName: string,

    // file storage type configuration
    fileStorageType: 'gridfs' | 's3';

    // apikey - ollama
    apiKeyOllamaValid: boolean;
    apiKeyOllamaEndpoint: string;

    // apikey - qdrant
    apiKeyQdrantValid: boolean;
    apiKeyQdrantEndpoint: string;
    apiKeyQdrantPassword: string;

    // apikey - replicate
    apiKeyReplicateValid: boolean;
    apiKeyReplicate: string;

    // apikey - runpod
    apiKeyRunpodValid: boolean;
    apiKeyRunpod: string;

    // apikey - openai
    apiKeyOpenaiValid: boolean;
    apiKeyOpenai: string;

    // apikey - localai (optional)
    apiKeyLocalaiValid: boolean;
    apiKeyLocalaiEndpoint: string;
    apiKeyLocalai: string;

    // smtp
    smtpValid: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword: string;
    smtpFrom: string;

    // user-email-verify
    userEmailVerifyOtp: number;
    userEmailVerifyEmail: string;
};

export default IUserApiKey;