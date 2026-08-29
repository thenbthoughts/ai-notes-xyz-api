import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";

import autoContextSelectByThreadId from "../../src/routes/chatLlm/chatLlmThreads/utils/autoContextSelect/autoContextSelectByMethodSearch";

const init = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);

        const threadId = new mongoose.Types.ObjectId('6974f5da780b269313f74b46');

        console.log('Testing autoContextSelectByThreadId with threadId:', threadId.toString());

        const result = await autoContextSelectByThreadId({
            threadId,
        });

        console.log('\n=== Test Results ===');
        console.log('Result:', JSON.stringify(result, null, 2));

        if (result && typeof result === 'object' && 'success' in result) {
            console.log('\n✅ Test completed successfully');
            if (result.success) {
                console.log('Keywords:', result.data?.keywords);
                console.log('Inserted Context References:', result.data?.insertedContextReferences);
            } else {
                console.log('❌ Function returned success: false');
            }
        } else {
            console.log('❌ Function returned false');
        }

        console.timeEnd('total-time');
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('Error in test:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
};

init();

// npx ts-node -r dotenv/config ./srcTest/2026-01-20-test-auto-context-select/test-auto-context-select.ts