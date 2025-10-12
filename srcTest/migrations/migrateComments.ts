import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";
import { ModelNotesComments } from "../../src/schema/schemaNotes/SchemaNotesComments.schema";
import { ModelCommentCommon } from "../../src/schema/schemaCommentCommon/SchemaCommentCommon.schema";
import { ModelTaskComments } from "../../src/schema/schemaTask/SchemaTaskComments.schema";

const migrateComments = async () => {
    try {
        await mongoose.connect(envKeys.MONGODB_URI);

        // get all notes comments
        const notesComments = await ModelNotesComments.aggregate([
            {
                $match: {
                    notesId: {
                        $ne: null,
                    },
                },
            },
        ]);

        for (const notesComment of notesComments) {
            try {
                console.log('Migrating note comment:', notesComment._id);
                await ModelCommentCommon.create({
                    ...notesComment,
                    commentType: 'note',
                    entityId: notesComment.notesId,
                });
            } catch (error) {
                console.error(error);
            }
        }

        // get all task comments
        const taskComments = await ModelTaskComments.aggregate([
            {
                $match: {
                    taskId: {
                        $ne: null,
                    },
                },
            },
        ]);

        for (const taskComment of taskComments) {
            try {
                console.log('Migrating task comment:', taskComment._id);
                await ModelCommentCommon.create({
                    ...taskComment,
                    commentType: 'task',
                    entityId: taskComment.taskId,
                });
            } catch (error) {
                console.error(error);
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        await mongoose.disconnect();
    }
};

migrateComments();

// to run:
// npx ts-node -r dotenv/config ./srcTest/migrations/migrateComments.ts