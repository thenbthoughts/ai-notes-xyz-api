import mongoose from 'mongoose';
import envKeys from '../../src/config/envKeys';

import { reindexAll } from '../../src/utils/search/reindexGlobalSearch';

const reindexAllDocuments = async () => {
    try {
        await mongoose.connect(envKeys.MONGODB_URI);

        await reindexAll({ userId: '669126666666666666666666' });

        await mongoose.disconnect();
    } catch (error) {
        console.error('Error reindexing all documents:', error);
    }
}

reindexAllDocuments();

// run the script
// npx ts-node -r dotenv/config ./srcTest/2026-01-17-reindex-document/reindex-document.ts