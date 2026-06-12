import mongoose, { Schema } from 'mongoose';
import IUserApiKey from '../../types/typesSchema/typesUser/SchemaUserApiKey.types';

// User api key schema
const userApiKeySchema = new Schema<IUserApiKey>({
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true, unique: true },

    // client frontend url
    clientFrontendUrl: { type: String, default: '' },

    // apikey - groq
    apiKeyGroqValid: { type: Boolean, default: false },
    apiKeyGroq: { type: String, default: '' },

    // apikey - openrouter
    apiKeyOpenrouterValid: { type: Boolean, default: false },
    apiKeyOpenrouter: { type: String, default: '' },

    // apikey - s3
    apiKeyS3Valid: { type: Boolean, default: false },
    apiKeyS3Endpoint: { type: String, default: '' },
    apiKeyS3Region: { type: String, default: '' },
    apiKeyS3AccessKeyId: { type: String, default: '' },
    apiKeyS3SecretAccessKey: { type: String, default: '' },
    apiKeyS3BucketName: { type: String, default: '' },

    // file storage type configuration
    fileStorageType: { type: String, enum: ['gridfs', 's3'], default: 'gridfs' },

    // apikey - ollama
    apiKeyOllamaValid: { type: Boolean, default: false },
    apiKeyOllamaEndpoint: { type: String, default: '' },

    // apikey - qdrant
    apiKeyQdrantValid: { type: Boolean, default: false },
    apiKeyQdrantEndpoint: { type: String, default: '' },
    apiKeyQdrantPassword: { type: String, default: '' },

    // apikey - replicate
    apiKeyReplicateValid: { type: Boolean, default: false },
    apiKeyReplicate: { type: String, default: '' },

    // apikey - runpod
    apiKeyRunpodValid: { type: Boolean, default: false },
    apiKeyRunpod: { type: String, default: '' },

    // apikey - openai
    apiKeyOpenaiValid: { type: Boolean, default: false },
    apiKeyOpenai: { type: String, default: '' },

    // apikey - localai (optional)
    apiKeyLocalaiValid: { type: Boolean, default: false },
    apiKeyLocalaiEndpoint: { type: String, default: '' },
    apiKeyLocalai: { type: String, default: '' },

    // smtp
    smtpValid: { type: Boolean, default: false },
    smtpHost: { type: String, default: '' },
    smtpPort: { type: Number, default: 0 },
    smtpUser: { type: String, default: '' },
    smtpPassword: { type: String, default: '' },
    smtpFrom: { type: String, default: '' },

    // telegram (Bot API — reminders & notifications)
    telegramValid: { type: Boolean, default: false },
    telegramBotToken: { type: String, default: '' },
    telegramChatId: { type: String, default: '' },
    /** set for Telegram forum supergroups (topic / “channel” inside the group) */
    telegramMessageThreadId: { type: Number, default: null },

    // ai-notes-xyz-shell (origin URL without /api, + X-API-Token)
    shellEngineValid: { type: Boolean, default: false },
    shellEngineUrl: { type: String, default: '' },
    shellEngineToken: { type: String, default: '' },

    // OpenCode server credentials (shared with OpenCode + shell integration)
    opencodeUsername: { type: String, default: '' },
    opencodePassword: { type: String, default: '' },

    // OpenCode + shell (separate shell origin + token; both must validate)
    apiKeyOpencodeWithShellValid: { type: Boolean, default: false },
    opencodeUrl: { type: String, default: '' },
    opencodeWithCustomShellUrl: { type: String, default: '' },
    opencodeWithCustomShellToken: { type: String, default: '' },

    // user-email-verify
    userEmailVerifyOtp: { type: Number, default: 0 },
    userEmailVerifyEmail: { type: String, default: '' },
});

// User Model
const ModelUserApiKey = mongoose.model<IUserApiKey>(
    'userApiKey',
    userApiKeySchema,
    'userApiKey'
);

export {
    ModelUserApiKey
};