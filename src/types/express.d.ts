// src/types/express.d.ts
import { Response } from 'express';

declare global {
    namespace Express {
        interface Response {
            locals: {
                apiKey: {
                    apiKeyGroqValid: boolean;
                    apiKeyGroq: string;
                    apiKeyOpenrouterValid: boolean;
                    apiKeyOpenrouter: string;
                    apiKeyS3Valid: boolean;
                    apiKeyS3Endpoint: string;
                    apiKeyS3Region: string;
                    apiKeyS3AccessKeyId: string;
                    apiKeyS3SecretAccessKey: string;
                    apiKeyS3BucketName: string;
                };
                auth_username?: string; // Optional if you want to keep it
            };
        }
    }
}