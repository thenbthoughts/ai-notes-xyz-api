import { DateTime } from 'luxon';

import { ModelNotes } from "../../../../schema/schemaNotes/SchemaNotes.schema";
import { ModelTaskSchedule } from '../../../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import { ModelUser } from '../../../../schema/schemaUser/SchemaUser.schema';
import { ModelNotesWorkspace } from '../../../../schema/schemaNotes/SchemaNotesWorkspace.schema';

import { tsTaskListSchedule } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';

import { funcSendMail } from '../../../files/funcSendMail';

const taskScheduleAddNotes = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // Step 1: Find and validate task schedule record
        const taskInfo = await ModelTaskSchedule.findOne({
            _id: targetRecordId,
        }) as tsTaskListSchedule;
        if (!taskInfo) {
            return true;
        }

        // Step 2: Get notes workspace (if specified in taskInfo, otherwise null)
        let notesWorkspaceId = null;
        // Note: If notesWorkspaceId is stored in taskInfo or a related schema, retrieve it here
        // For now, we'll use null as default

        let noteTitle = taskInfo.title || 'Scheduled Note';
        let noteDescription = taskInfo.description || '';

        // Add date/time prefix if needed (similar to task schedule)
        // This would be configured in a notesAdd-specific schema if it existed
        // For now, we'll use the taskInfo title and description directly

        // Insert note
        const noteInsert = await ModelNotes.create({
            username: taskInfo.username,
            notesWorkspaceId: notesWorkspaceId,
            title: noteTitle,
            description: noteDescription,
            isStar: false,
            tags: [],
        });

        // Get user info for email
        const userInfo = await ModelUser.findOne({
            username: taskInfo.username,
        });
        if (!userInfo) {
            return true;
        }

        // Generate mail content
        const mailContent = `
        <h1>Note schedule - ${noteTitle}</h1>
        <p>${noteDescription}</p>
        <p>Note ID: ${noteInsert._id}</p>
        <p><a href="https://demo.ai-notes.xyz/user/notes?edit-note-id=${noteInsert._id}">View Note</a></p>
        `;

        // Send mail if configured
        if (taskInfo.shouldSendEmail) {
            await funcSendMail({
                username: taskInfo.username,
                smtpTo: userInfo.email,
                subject: `Note schedule - ${noteTitle} | AI Notes XYZ`,
                text: '',
                html: mailContent,
            });
        }

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default taskScheduleAddNotes;
