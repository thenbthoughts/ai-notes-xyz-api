import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";

import generateFaqBySourceId from "../../src/utils/llmPendingTask/page/featureAiAction/featureAiActionAll/faq/generateFaqBySourceId";
import { ModelFaq } from "../../src/schema/schemaFaq/SchemaFaq.schema";

import { ModelNotes } from "../../src/schema/schemaNotes/SchemaNotes.schema";
import { ModelTask } from "../../src/schema/schemaTask/SchemaTask.schema";
import { ModelChatLlm } from "../../src/schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelLifeEvents } from "../../src/schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ModelInfoVault } from "../../src/schema/schemaInfoVault/SchemaInfoVault.schema";

const init = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);

        const username = 'exampleuser';

        const notes = await ModelNotes.findOne({
            username: username,
        });

        if (!notes) {
            throw new Error('Notes not found');
        }

        const notesSourceId = notes._id as string;

        // Test with a notes source
        console.log('Testing FAQ generation for notes...');

        const notesResult = await generateFaqBySourceId({
            targetRecordId: notesSourceId,
            sourceType: 'notes',
        });

        console.log('Notes FAQ generation result:', notesResult);

        // Test with a tasks source
        const tasks = await ModelTask.findOne({
            username: username,
        });

        if (!tasks) {
            throw new Error('Tasks not found');
        }

        const tasksSourceId = tasks._id as string;
        console.log('\nTesting FAQ generation for tasks...');

        const tasksResult = await generateFaqBySourceId({
            targetRecordId: tasksSourceId,
            sourceType: 'tasks',
        });

        console.log('Tasks FAQ generation result:', tasksResult);

        // Test with a chatLlm source
        const chatLlm = await ModelChatLlm.findOne({
            username: username,
        });

        if (!chatLlm) {
            throw new Error('ChatLlm not found');
        }

        const chatLlmSourceId = chatLlm._id.toString();

        // Test with a lifeEvents source
        const lifeEvents = await ModelLifeEvents.findOne({
            username: username,
        });

        if (!lifeEvents) {
            throw new Error('LifeEvents not found');
        }

        const lifeEventsSourceId = lifeEvents._id as string;
        console.log('\nTesting FAQ generation for lifeEvents...');

        const lifeEventsResult = await generateFaqBySourceId({
            targetRecordId: lifeEventsSourceId,
            sourceType: 'lifeEvents',
        });

        console.log('LifeEvents FAQ generation result:', lifeEventsResult);

        // Test with an infoVault source
        const infoVault = await ModelInfoVault.findOne({
            username: username,
        });

        if (!infoVault) {
            throw new Error('InfoVault not found');
        }

        const infoVaultSourceId = infoVault._id as string;
        console.log('\nTesting FAQ generation for infoVault...');

        const infoVaultResult = await generateFaqBySourceId({
            targetRecordId: infoVaultSourceId,
            sourceType: 'infoVault',
        });

        console.log('InfoVault FAQ generation result:', infoVaultResult);

        // Retrieve and display generated FAQs
        console.log('\nRetrieving generated FAQs...');
        const generatedFaqs = await ModelFaq.find({
            username: username,
        }).sort({ createdAtUtc: -1 }).limit(20);

        console.log(`\nFound ${generatedFaqs.length} FAQs:`);
        generatedFaqs.forEach((faq, index) => {
            console.log(`\n--- FAQ ${index + 1} ---`);
            console.log('Question:', faq.question);
            console.log('Answer:', faq.answer);
            console.log('Category:', faq.aiCategory);
            console.log('SubCategory:', faq.aiSubCategory);
            console.log('Tags:', faq.tags);
            console.log('Source Type:', faq.metadataSourceType);
            console.log('Source ID:', faq.metadataSourceId);
        });

        console.timeEnd('total-time');
        await mongoose.disconnect();
    } catch (error) {
        console.error('Error in test:', error);
        await mongoose.disconnect();
    }
}

init();

// npx ts-node -r dotenv/config ./srcTest/2026-01-02-test-faq/test-llm.ts