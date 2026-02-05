const envKeys = {
    CUSTOM_NODE_ENV: 'local' as 'local' | 'dev' | 'prod',
    EXPRESS_PORT: 2000,

    // additional origin
    FRONTEND_CLIENT_URL: process.env.FRONTEND_CLIENT_URL || 'localhost:3000',
    API_URL: process.env.API_URL || 'http://localhost:2000',

    // mongodb url
    MONGODB_URI: process.env.MONGODB_URI || '',
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