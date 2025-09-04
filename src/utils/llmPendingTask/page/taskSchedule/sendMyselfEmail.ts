import { DateTime } from 'luxon';

import { ModelTaskSchedule } from '../../../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import { ModelUser } from '../../../../schema/SchemaUser.schema';
import { ModelUserApiKey } from "../../../../schema/SchemaUserApiKey.schema";

import { tsTaskListSchedule } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';
import { tsTaskListScheduleSendMyselfEmail } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListScheduleSendMyselfEmail.types';

import { funcSendMail } from '../../../files/funcSendMail';
import { ModelTaskScheduleSendMyselfEmail } from '../../../../schema/schemaTaskSchedule/SchemaTaskScheduleSendMyselfEmail.schema';

// const generateAiGeneratedEmailContent = async ({
//     emailContent,
// }: {
//     emailContent: string;
// }) => {
//     try {
        
//     } catch (error) {
//         console.error(error);
//         return '';
//     }
// };

const sendMyselfEmail = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        // Step 1: Find and validate task record
        const taskInfo = await ModelTaskSchedule.findOne({
            _id: targetRecordId,
        }) as tsTaskListSchedule;
        if (!taskInfo) {
            return true;
        }

        // Step 2: Get send myself email record
        const sendMyselfEmailInfo = await ModelTaskScheduleSendMyselfEmail.findOne({
            taskScheduleId: taskInfo._id,
        }) as tsTaskListScheduleSendMyselfEmail;
        if (!sendMyselfEmailInfo) {
            return true;
        }

        // Step 3: validate api keys
        const apiKeys = await ModelUserApiKey.findOne({
            username: taskInfo.username,
            smtpValid: true,
        });
        if (!apiKeys) {
            return true;
        }

        // Step 4: get user email
        const userInfo = await ModelUser.findOne({
            username: taskInfo.username,
        });
        if (!userInfo) {
            return true;
        }

        let emailSubject = `${sendMyselfEmailInfo.emailSubject} | AI Notes XYZ`;
        
        let emailContent = `
        <html>
        <body>
            <div>
                <h2>${sendMyselfEmailInfo.emailSubject}</h2>
                <p>${sendMyselfEmailInfo.emailContent.replace(/\n/g, '<br>')}</p>

                <hr style="border: 1px solid #ccc; margin: 20px 0;">

                <p style="color: #888; font-size: 14px;">
                    <strong>Current Time:</strong> ${DateTime.now().setZone(taskInfo.timezoneName || 'UTC').toFormat('yyyy-MM-dd HH:mm:ss ZZZZ')}
                </p>

                <hr style="border: 1px solid #ccc; margin: 20px 0;">

                <p style="color: #666; font-size: 12px; font-style: italic;">
                    This is an automated email sent to yourself via AI Notes XYZ task scheduler.
                </p>
                <p><a href="${apiKeys.clientFrontendUrl}/user/task-schedule">View Task Schedule</a></p>
                <p>Sent from <a href="${apiKeys.clientFrontendUrl}">AI Notes XYZ</a></p>
            </div>
        </body>
        </html>
        `;

        // Step 5: send mail
        await funcSendMail({
            username: taskInfo.username,
            smtpTo: userInfo.email,
            subject: emailSubject,
            text: '',
            html: emailContent,
        });

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default sendMyselfEmail;