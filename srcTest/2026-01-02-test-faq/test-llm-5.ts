import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";
import { ollamaInsertModelModality } from "../../src/routes/dynamicData/modelOllama.route";


const init = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);

        // Test vision model
        const resultVision = await ollamaInsertModelModality({
            modelName: "qwen3-vl:2b",
            provider: "ollama",
            username: "ollama",
        });
        console.log('Vision model (qwen3-vl:2b):', resultVision);

        // Test text-only model
        const resultTextOnly = await ollamaInsertModelModality({
            modelName: "llama3.2:1b",
            provider: "ollama",
            username: "ollama",
        });
        console.log('Text-only model (llama3.2:1b):', resultTextOnly);

        console.timeEnd('total-time');
        await mongoose.disconnect();
    } catch (error) {
        console.error('Error in test:', error);
        await mongoose.disconnect();
    }
}

init();

// npx ts-node -r dotenv/config ./srcTest/2026-01-02-test-faq/test-llm-5.ts