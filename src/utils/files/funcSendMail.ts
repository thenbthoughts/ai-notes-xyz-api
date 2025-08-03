import nodemailer from 'nodemailer';
import { ModelUserApiKey } from '../../schema/SchemaUserApiKey.schema';

export const funcSendMail = async ({
    username,
    smtpTo,
    subject,
    text,
}: {
    username: string;
    smtpTo: string;
    subject: string;
    text: string;
}): Promise<boolean> => {
    try {
        // validate
        if (!username || !smtpTo || !subject || !text) {
            return false;
        }

        // get user
        const user = await ModelUserApiKey.findOne({
            username: username
        });

        if (!user) {
            return false;
        }

        const smtpHost = user.smtpHost;
        const smtpPort = user.smtpPort;
        const smtpUser = user.smtpUser;
        const smtpPassword = user.smtpPassword;
        const smtpFrom = user.smtpFrom;

        let sendStatus = false;

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            auth: {
                user: smtpUser,
                pass: smtpPassword,
            },
        });

        const info = await transporter.sendMail({
            from: smtpFrom,
            to: smtpTo,
            subject: subject,
            text: text,
        });

        console.log('info: ', info);

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

