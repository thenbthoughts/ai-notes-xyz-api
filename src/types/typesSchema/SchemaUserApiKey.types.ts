import { Document } from 'mongoose';

interface IUserApiKey extends Document {
    username: string;

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
};

export default IUserApiKey;