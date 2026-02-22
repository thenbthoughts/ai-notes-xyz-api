import { ModelUser } from '../../schema/schemaUser/SchemaUser.schema';
import { generateHomepageSummary } from '../../routes/dashboard/utils/generateHomepageSummary';
import { ModelHomepageSummary } from '../../schema/schemaHomepageSummary/SchemaHomepageSummary.schema';

const processHomepageSummary = async () => {
    try {
        console.log('running a task every day for all users');

        // Get all users
        const allUsers = await ModelUser.find({
            featureAiActionsEnabled: true,
        }, { username: 1 }).lean();

        console.log(`Found ${allUsers.length} users to process homepage summaries`);

        for (const user of allUsers) {
            try {
                console.log(`Generating homepage summary for user: ${user.username}`);

                // Generate the homepage summary
                const summaryText = await generateHomepageSummary(user.username);

                if (summaryText && summaryText.trim().length > 0) {
                    // Create new homepage summary document
                    await ModelHomepageSummary.create({
                        username: user.username,
                        generatedAtUtc: new Date(),
                        summary: summaryText,
                    });

                    console.log(`Successfully generated homepage summary for ${user.username}`);
                } else {
                    console.log(`No summary generated for ${user.username} (no sufficient data)`);
                }
            } catch (userError) {
                console.error(`Error processing homepage summary for user ${user.username}:`, userError);
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