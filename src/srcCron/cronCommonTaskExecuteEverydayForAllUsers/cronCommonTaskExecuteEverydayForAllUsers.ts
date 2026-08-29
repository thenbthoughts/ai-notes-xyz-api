import { ModelUser } from '../../schema/schemaUser/SchemaUser.schema';
import { generateHomepageSummary } from '../../routes/dashboard/utils/generateHomepageSummary';
import { ModelHomepageSummary } from '../../schema/schemaHomepageSummary/SchemaHomepageSummary.schema';

const processHomepageSummary = async () => {
    try {
        console.log('running a task every day for all users');

        // Get all users
        const allUsers = await ModelUser.find({
            featureAiActionsEnabled: true,
        }, { _id: 1 }).lean();

        console.log(`Found ${allUsers.length} users to process homepage summaries`);

        for (const user of allUsers) {
            try {
                const uid = user._id;
                console.log(`Generating homepage summary for user: ${uid}`);

                // Generate the homepage summary (uid is the User _id)
                const summaryText = await generateHomepageSummary(String(uid));

                if (summaryText && summaryText.trim().length > 0) {
                    // Create new homepage summary document
                    await ModelHomepageSummary.create({
                        userId: uid,
                        generatedAtUtc: new Date(),
                        summary: summaryText,
                    });

                    console.log(`Successfully generated homepage summary for ${uid}`);
                } else {
                    console.log(`No summary generated for ${uid} (no sufficient data)`);
                }
            } catch (userError) {
                console.error(`Error processing homepage summary for user ${user._id}:`, userError);
                // Continue processing other users even if one fails
            }
        }

        console.log('Completed homepage summary generation for all users');
    } catch (error) {
        console.error(`Error generating homepage summary for all users:`, error);
    }
}

const cronCommonTaskExecuteEverydayForAllUsers = async () => {
    try {
        await processHomepageSummary();
    } catch (error) {
        console.error('Error in cronCommonTaskExecuteEverydayForAllUsers:', error);
    }
}

export default cronCommonTaskExecuteEverydayForAllUsers;