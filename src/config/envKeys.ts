const envKeys = {
    CUSTOM_NODE_ENV: 'local' as 'local' | 'dev' | 'prod',
    EXPRESS_PORT: 2000,

    // additional origin
    FRONTEND_CLIENT_URL: process.env.FRONTEND_CLIENT_URL || 'localhost:3000',
    API_URL: process.env.API_URL || 'http://localhost:2000',

    // mongodb url
    MONGODB_URI: process.env.MONGODB_URI || '',

    // 
    DEFAULT_ENV_ENABLED: (process.env?.DEFAULT_ENV_ENABLED === "yes") ? 'yes' : 'no' as "yes" | "no",

    // llm
    DEFAULT_ENV_GROQ_API_KEY: process.env.DEFAULT_ENV_GROQ_API_KEY || '',
    DEFAULT_ENV_OPEN_ROUTER_KEY: process.env.DEFAULT_ENV_OPEN_ROUTER_KEY || '',

    // S3
    DEFAULT_ENV_S3_ENDPOINT: process.env.DEFAULT_ENV_S3_ENDPOINT || '',
    DEFAULT_ENV_S3_REGION: process.env.DEFAULT_ENV_S3_REGION || '',
    DEFAULT_ENV_S3_ACCESS_KEY_ID: process.env.DEFAULT_ENV_S3_ACCESS_KEY_ID || '',
    DEFAULT_ENV_S3_SECRET_ACCESS_KEY: process.env.DEFAULT_ENV_S3_SECRET_ACCESS_KEY || '',
    DEFAULT_ENV_S3_BUCKET_NAME: process.env.DEFAULT_ENV_S3_BUCKET_NAME || '',
};

if(process.env.EXPRESS_PORT) {
    const temp_EXPRESS_PORT = parseInt(process.env.EXPRESS_PORT);
    if(temp_EXPRESS_PORT >= 1) {
        envKeys.EXPRESS_PORT = temp_EXPRESS_PORT;
    }
}

if (
    process.env.CUSTOM_NODE_ENV === 'local' ||
    process.env.CUSTOM_NODE_ENV === 'dev' ||
    process.env.CUSTOM_NODE_ENV === 'prod'
) {
    envKeys.CUSTOM_NODE_ENV = process.env.CUSTOM_NODE_ENV;
}

export default envKeys;