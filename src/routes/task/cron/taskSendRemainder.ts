import mongoose from "mongoose";
import { ModelTask } from "../../../schema/schemaTask/SchemaTask.schema";
import { funcSendMail } from "../../../utils/files/funcSendMail";
import { ModelUser } from "../../../schema/schemaUser/SchemaUser.schema";
import { ModelUserApiKey } from "../../../schema/schemaUser/SchemaUserApiKey.schema";

const processTask = async ({
    _id,
}: {
    _id: mongoose.Types.ObjectId;
}) => {
    try {
        console.log('processing task: ', _id);
        const resultTask = await ModelTask.findOne({ _id });
        if (!resultTask) {
            throw new Error('Task not found');
        }
        if (resultTask.reminderPresetTimes.length === 0) {
            return false;
        }

        // get user email
        const userInfo = await ModelUser.findOne({
            username: resultTask.username,
            emailVerified: true,
            email: {
                $ne: '',
            },
        });
        if (!userInfo) {
            throw new Error('User not found');
        }

        // get api keys
        const apiKeys = await ModelUserApiKey.findOne({
            username: resultTask.username,
        });
        if (!apiKeys) {
            throw new Error('Api keys not found');
        }

        const currentTimeUtc = new Date();
        let shouldSendEmail = false;
        let reminderPresetTime = new Date();

        for (const iReminderPresetTime of resultTask.reminderPresetTimes) {
            if (iReminderPresetTime <= currentTimeUtc) {
                shouldSendEmail = true;
                reminderPresetTime = iReminderPresetTime;
                break;
            }
        }

        if (!shouldSendEmail) {
            return false;
        }

        const emailSubject = `Task Reminder: ${resultTask.title}`;
        const emailBody = `
            <p>Hello,</p>
            <p>This is a reminder for your task:</p>
            <ul>
                <li><strong>Title:</strong> ${resultTask.title}</li>
                <li><strong>Description:</strong> ${resultTask.description || 'No description'}</li>
                <li><strong>Due Date:</strong> ${resultTask.dueDate ? new Date(resultTask.dueDate).toUTCString() : 'No due date'}</li>
                <a href="${apiKeys.clientFrontendUrl}/user/task?edit-task-id=${resultTask._id}">View Task</a>
            </ul>
            <p>Please take the necessary action.</p>
        `;

        let userEmail = userInfo.email;

        let sent = false;
        if (userEmail && userEmail.includes('@')) {
            try {
                await funcSendMail({
                    username: userInfo.username,
                    smtpTo: userEmail,
                    subject: emailSubject,
                    text: '',
                    html: emailBody,
                });
                console.log(`Reminder email sent to ${userEmail} for task ${resultTask._id}`);
                sent = true;
            } catch (mailErr) {
                console.error('Failed to send reminder email:', mailErr);
            }
        } else {
            console.warn(`No valid email found for user: ${userInfo.username}`);
        }

        // Mark the reminder as completed if sent
        if (sent) {
            await ModelTask.updateOne({ _id }, {
                $set: {
                    reminderPresetTimes: resultTask.reminderPresetTimes.filter(
                        time => time.getTime() !== reminderPresetTime.getTime()
                    ),
                    reminderPresetTimesCompleted: [
                        ...resultTask.reminderPresetTimesCompleted,
                        reminderPresetTime,
                    ].sort((a, b) => a.getTime() - b.getTime()),
                },
            });
        }

        return sent;
    } catch (error) {
        console.log('error in processTask: ', error);
        return false;
    }
};

export const cronTaskSendRemainder = async () => {
    const currentTimeUtc = new Date();

    try {
        console.log('running a task every 5 minutes');

        const results = await ModelTask.find({
            reminderPresetTimes: {
                $ne: null,
                $lte: currentTimeUtc,
            },
        });

        for (const result of results) {
            console.log('result: ', result);
        }

        for (const result of results) {
            await processTask({
                _id: result._id as mongoose.Types.ObjectId,
            });
        }
    } catch (error) {
        console.log('error in cron: ', error);
    }
}