import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserNotification } from '../../schema/schemaUser/SchemaUserNotification';

export const funcSendMail = async ({
    userId,
    smtpTo,
    subject,
    text,
    html,
}: {
    userId: string | mongoose.Types.ObjectId;
    smtpTo: string;
    subject: string;
    text: string;
    html?: string;
}): Promise<boolean> => {
    try {
        // validate
        if (!userId || !smtpTo || !subject) {
            return false;
        }

        // get user
        const apiKeys = await ModelUserApiKey.findOne({
            userId: userId
        });

        if (!apiKeys) {
            return false;
        }

        const smtpHost = apiKeys.smtpHost;
        const smtpPort = apiKeys.smtpPort;
        const smtpUser = apiKeys.smtpUser;
        const smtpPassword = apiKeys.smtpPassword;
        const smtpFrom = apiKeys.smtpFrom;

        let sendStatus = false;

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            auth: {
                user: smtpUser,
                pass: smtpPassword,
            },
        });

        let mailOptions: any = {
            from: smtpFrom,
            to: smtpTo,
            subject: subject,
        };
        if (typeof html === 'string' && html.length >= 1) {
            mailOptions.html = html;
        } else {
            mailOptions.text = text;
        }

        // insert into user notification
        await ModelUserNotification.create({
            userId: userId,
            smtpTo: smtpTo,
            subject: subject,
            text: text,
            html: html,
            channel: 'email',
            telegramChatId: '',
        });
        
        // if not valid credentials, return false
        if (apiKeys.smtpValid === true) {
            // validate credentials
        } else {
            return false;
        }

        const info = await transporter.sendMail(mailOptions);

        if (info.accepted.length > 0) {
            sendStatus = true;
        } else {
            sendStatus = false;
        }

        return sendStatus;
    } catch (error) {
        console.error(error);
        return false;
    }
};

