import { DateTime } from 'luxon';

import { ModelTaskSchedule } from '../../../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import { ModelUser } from '../../../../schema/schemaUser/SchemaUser.schema';
import { ModelUserApiKey } from "../../../../schema/schemaUser/SchemaUserApiKey.schema";
import IUserApiKey from '../../../../types/typesSchema/typesUser/SchemaUserApiKey.types';

import { tsTaskListSchedule } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';
import { tsTaskListScheduleSendMyselfEmail } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListScheduleSendMyselfEmail.types';

import { funcSendMail } from '../../../files/funcSendMail';
import { ModelTaskScheduleSendMyselfEmail } from '../../../../schema/schemaTaskSchedule/SchemaTaskScheduleSendMyselfEmail.schema';
import fetchLlmUnified from '../../utils/fetchLlmUnified';
import { getDefaultLlmModel } from '../../utils/getDefaultLlmModel';

const generateAiGeneratedEmailContent = async ({
    sendMyselfEmailInfo,
    username,
}: {
    sendMyselfEmailInfo: tsTaskListScheduleSendMyselfEmail;
    username: string;
}) => {
    try {
        // Get LLM config using centralized function
        const llmConfig = await getDefaultLlmModel(username);
        if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) {
            return '';
        }

        // Use configured model name if provided, otherwise use default
        const modelName = sendMyselfEmailInfo.aiModelName.length > 0 
            ? sendMyselfEmailInfo.aiModelName 
            : llmConfig.modelName;

        const emailSubject = await fetchLlmUnified({
            provider: llmConfig.provider as 'openrouter' | 'groq' | 'ollama' | 'openai-compatible',
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: modelName,
            messages: [
                { role: 'system', content: sendMyselfEmailInfo.systemPrompt },
                { role: 'user', content: `Email Subject: ${sendMyselfEmailInfo.emailSubject}` },
                { role: 'user', content: `Email Content: ${sendMyselfEmailInfo.emailContent}` },
                { role: 'user', content: sendMyselfEmailInfo.userPrompt },
            ],
        });

        if (!emailSubject.success || !emailSubject.content) {
            return '';
        }

        console.log('emailSubject', emailSubject);

        return emailSubject.content;
    } catch (error) {
        console.error(error);
        return '';
    }
};

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

        // Step 3: validate api keys (for SMTP)
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

        // step 5: llm ai
        let aiResponse= ``;
        if (
            sendMyselfEmailInfo.aiEnabled &&
            sendMyselfEmailInfo.systemPrompt.length > 0 &&
            sendMyselfEmailInfo.userPrompt.length > 0
        ) {
            console.time('generateAiGeneratedEmailContent');
            const emailSubjectAiResponse = await generateAiGeneratedEmailContent({
                sendMyselfEmailInfo,
                username: taskInfo.username,
            });
            console.timeEnd('generateAiGeneratedEmailContent');
            if (emailSubjectAiResponse.length > 0) {
                aiResponse += '<br>';

                aiResponse += '<br>';
                aiResponse += '<strong>System prompt:</strong><br>';
                aiResponse += `${sendMyselfEmailInfo.systemPrompt.replace(/\n/g, '<br>')}`;
                aiResponse += '<br>';

                aiResponse += '<br>';
                aiResponse += '<strong>User prompt:</strong><br>';
                aiResponse += `${sendMyselfEmailInfo.userPrompt.replace(/\n/g, '<br>')}`;
                aiResponse += '<br>';

                aiResponse += '<br>';
                aiResponse += '<strong>AI:</strong><br>';
                aiResponse += `${emailSubjectAiResponse.replace(/\n/g, '<br>')}`;
                aiResponse += '<br>';

                aiResponse += '<br>';
                aiResponse += '<hr style="border: 1px solid #ccc; margin: 20px 0;">';
                aiResponse += '<br>';
            }
        }

        let emailSubject = `${sendMyselfEmailInfo.emailSubject} | AI Notes XYZ`;

        let emailContent = `
        <html>
        <body>
            <div style="max-width: 600px; margin: 0 auto;">
                <h2>${sendMyselfEmailInfo.emailSubject}</h2>
                <p>${sendMyselfEmailInfo.emailContent.replace(/\n/g, '<br>')}</p>
                
                <hr style="border: 1px solid #ccc; margin: 20px 0;">

                ${aiResponse}

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