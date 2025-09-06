import nodemailer from 'nodemailer';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import { ModelUserNotification } from '../../schema/schemaUser/SchemaUserNotification';

export const funcSendMail = async ({
    username,
    smtpTo,
    subject,
    text,
    html,
}: {
    username: string;
    smtpTo: string;
    subject: string;
    text: string;
    html?: string;
}): Promise<boolean> => {
    try {
        // validate
        if (!username || !smtpTo || !subject) {
            return false;
        }

        // get user
        const apiKeys = await ModelUserApiKey.findOne({
            username: username
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
            username: username,
            smtpTo: smtpTo,
            subject: subject,
            text: text,
            html: html,
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

