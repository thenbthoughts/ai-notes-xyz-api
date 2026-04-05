import { DateTime } from 'luxon';

import { ModelTaskSchedule } from '../../../../schema/schemaTaskSchedule/SchemaTaskSchedule.schema';
import { ModelUser } from '../../../../schema/schemaUser/SchemaUser.schema';
import { ModelUserApiKey } from "../../../../schema/schemaUser/SchemaUserApiKey.schema";

import { tsTaskListSchedule } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListSchedule.types';
import { tsTaskListScheduleSendMyselfEmail } from '../../../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListScheduleSendMyselfEmail.types';

import { funcSendMail } from '../../../files/funcSendMail';
import { funcSendTelegram } from '../../../files/funcSendTelegram';
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
            provider: llmConfig.provider as 'openrouter' | 'groq' | 'ollama' | 'localai' | 'openai-compatible',
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

        let sendMailEnabled = true;
        if (sendMyselfEmailInfo.sendMailEnabled === false) {
            sendMailEnabled = false;
        }
        const sendTelegramEnabled =
            sendMyselfEmailInfo.sendTelegramEnabled === true;

        // step 3: llm ai
        let aiResponse = ``;
        let aiPlainForTelegram = '';
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

                aiPlainForTelegram = [
                    'System prompt:',
                    sendMyselfEmailInfo.systemPrompt,
                    '',
                    'User prompt:',
                    sendMyselfEmailInfo.userPrompt,
                    '',
                    'AI:',
                    emailSubjectAiResponse,
                ].join('\n');
            }
        }

        let emailSubject = `${sendMyselfEmailInfo.emailSubject} | AI Notes XYZ`;

        const keysForFooter = await ModelUserApiKey.findOne({
            username: taskInfo.username,
        })
            .select('clientFrontendUrl')
            .lean();
        let clientFrontendUrl = '';
        if (typeof keysForFooter?.clientFrontendUrl === 'string') {
            clientFrontendUrl = keysForFooter.clientFrontendUrl;
        }

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
                <p><a href="${clientFrontendUrl}/user/task-schedule">View Task Schedule</a></p>
                <p>Sent from <a href="${clientFrontendUrl}">AI Notes XYZ</a></p>
            </div>
        </body>
        </html>
        `;

        if (!sendMailEnabled && !sendTelegramEnabled) {
            return true;
        }

        let anyChannel = false;
        let allOk = true;

        if (sendMailEnabled) {
            anyChannel = true;
            const apiKeysSmtp = await ModelUserApiKey.findOne({
                username: taskInfo.username,
                smtpValid: true,
            });
            const userInfo = await ModelUser.findOne({
                username: taskInfo.username,
            });
            if (!apiKeysSmtp || !userInfo) {
                allOk = false;
            } else {
                try {
                    await funcSendMail({
                        username: taskInfo.username,
                        smtpTo: userInfo.email,
                        subject: emailSubject,
                        text: '',
                        html: emailContent,
                    });
                } catch (_mailErr) {
                    allOk = false;
                }
            }
        }

        if (sendTelegramEnabled) {
            const emailSubjectTelegram = `${sendMyselfEmailInfo.emailSubject}`;

            anyChannel = true;
            let threadOverride: number | null = null;
            const rawT = sendMyselfEmailInfo.telegramMessageThreadId;
            if (typeof rawT === 'number' && rawT > 0) {
                threadOverride = rawT;
            }
            let chatOverride = '';
            if (typeof sendMyselfEmailInfo.telegramChatId === 'string') {
                chatOverride = sendMyselfEmailInfo.telegramChatId.trim();
            }

            const timeLineTelegram = DateTime.now()
                .setZone(taskInfo.timezoneName || 'UTC')
                .toFormat('yyyy-MM-dd HH:mm:ss ZZZZ');

            const textTelegramParts: string[] = [
                `📝 ${sendMyselfEmailInfo.emailSubject ?? ''}`,
                '',
                typeof sendMyselfEmailInfo.emailContent === 'string'
                    ? sendMyselfEmailInfo.emailContent
                    : '',
            ];
            if (aiPlainForTelegram.length > 0) {
                textTelegramParts.push('', '────────', '', aiPlainForTelegram);
            }
            textTelegramParts.push(
                '',
                `Current time: ${timeLineTelegram}`,
                '',
                'This is an automated message from AI Notes XYZ task scheduler.',
                `View task schedule: ${clientFrontendUrl}/user/task-schedule`,
                `Sent from: ${clientFrontendUrl}`
            );

            let textTelegram = textTelegramParts.join('\n').trim();

            if (textTelegram.length > 4000) {
                textTelegram = textTelegram.slice(0, 3997) + '...';
            }

            const tgOk = await funcSendTelegram({
                username: taskInfo.username,
                subject: emailSubjectTelegram,
                text: textTelegram,
                html: '',
                overrideChatId: chatOverride,
                overrideMessageThreadId: threadOverride,
            });
            if (!tgOk) {
                allOk = false;
            }
        }

        if (!anyChannel) {
            return true;
        }
        return allOk;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default sendMyselfEmail;