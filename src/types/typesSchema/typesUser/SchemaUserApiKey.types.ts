import { Document, Types } from 'mongoose';

interface IUserApiKey extends Document {
    userId: Types.ObjectId;

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

    // telegram
    telegramValid: boolean;
    telegramBotToken: string;
    telegramChatId: string;
    /** forum topic id; omit or null for non-forum chats */
    telegramMessageThreadId?: number | null;

    /** ai-notes-xyz-shell: server origin only, no /api (e.g. http://host:2001) */
    shellEngineValid: boolean;
    shellEngineUrl: string;
    shellEngineToken: string;

    /** ai-notes-xyz-libreoffice: desktop origin + basic auth; utils API origin + X-API-Token */
    libreOfficeValid: boolean;
    libreOfficeUrl: string;
    libreOfficeBasicAuthUsername: string;
    libreOfficeBasicAuthPassword: string;
    libreOfficeUtilsUrl: string;
    libreOfficeUtilsToken: string;

    /** OpenCode server credentials (shared with OpenCode + shell integration) */
    opencodeUsername: string;
    opencodePassword: string;

    /** OpenCode + ai-notes-xyz-shell token */
    apiKeyOpencodeWithShellValid: boolean;
    opencodeUrl: string;
    opencodeWithCustomShellUrl: string;
    opencodeWithCustomShellToken: string;

    // user-email-verify
    userEmailVerifyOtp: number;
    userEmailVerifyEmail: string;
};

export default IUserApiKey;