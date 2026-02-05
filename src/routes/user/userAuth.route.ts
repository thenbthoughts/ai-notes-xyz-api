import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

import {
    ModelUser
} from '../../schema/schemaUser/SchemaUser.schema';
import {
    ModelUserDeviceList
} from '../../schema/schemaUser/SchemaUserDeviceList.schema';
import { funcSendMail } from '../../utils/files/funcSendMail';
import { DateTime } from 'luxon';
import { middlewareActionDatetime } from '../../middleware/middlewareActionDatetime';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { body } from 'express-validator';
import middlewareExpressValidator from '../../middleware/middlewareExpressValidator';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';

// Router
const router = Router();

// Login API
router.post('/login', middlewareActionDatetime, async (req: Request, res: Response) => {
    const { username, password } = req.body;

    try {
        const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);
        console.log(actionDatetimeObj);

        // Find user by username
        const user = await ModelUser.findOne({ username }).select('+password');
        if (!user) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        // Check password
        console.log('password: ', password);
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }
        console.log('isMatch: ', isMatch);

        // Generate random device id
        const randomDeviceId = crypto.randomBytes(64).toString('hex');

        // Save user device list
        const userDeviceList = await ModelUserDeviceList.create({
            username: user.username,
            randomDeviceId,
            isExpired: false,

            userAgent: actionDatetimeObj.createdAtUserAgent,
            createdAt: actionDatetimeObj.createdAtUtc,
            createdAtIpAddress: actionDatetimeObj.createdAtIpAddress,
            updatedAt: actionDatetimeObj.updatedAtUtc,
            updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress,
        });

        // send email verification - you have successfully logged in to your account
        try {
            if (user.emailVerified) {
                let currentTime = new Date();
                let text = `Hello from AI Notes XYZ.  \n`;
                text += `You have successfully logged in to your account.  \n`;
                text += `Ip address: ${actionDatetimeObj.createdAtIpAddress}  \n`;
                text += `User agent: ${actionDatetimeObj.createdAtUserAgent}  \n`;
                text += `Time: ${currentTime.toISOString()} UTC.  \n`;
                if (user.timeZoneUtcOffset) {
                    const luxonDate = DateTime.now().toUTC().plus({ minutes: user.timeZoneUtcOffset });
                    const formattedDate = luxonDate.toFormat('EEE MMM dd yyyy HH:mm:ss');
                    text += `Time (${user.timeZoneRegion}): ${formattedDate}. \n`;
                }
                text += `If this was not you, please secure your account immediately.  \n`;
                text += `Thank you for using AI Notes XYZ.`;

                console.log('text send sms: ', text);

                const sendStatus = await funcSendMail({
                    username: user.username,
                    smtpTo: user.email,
                    subject: 'AI Notes XYZ - Login Successfully',
                    text,
                });
                if (!sendStatus) {
                    console.error('Failed to send email verification');
                }
            }
        } catch (error) {
            console.error(error);
        }

        // cookie
        res.cookie(
            'randomDeviceId',
            randomDeviceId,
            {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                path: '/',
                maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
            }
        );

        return res.json({
            randomDeviceId,
            userDeviceList
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Register API
router.post('/register', async (req: Request, res: Response) => {
    const { username, password } = req.body;

    try {
        // Check if the user already exists
        const existingUser = await ModelUser.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save the user to the database
        const newUser = await ModelUser.create({
            username,
            password: hashedPassword,
        });


        return res.status(201).json({
            message: 'User registered successfully',
            data: {
                user: {
                    username: newUser.username,
                },
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Logout API
router.post('/logout', async (req: Request, res: Response) => {
    const { randomDeviceId } = req.cookies;

    try {
        // Find user device list by randomDeviceId
        const userDeviceList = await ModelUserDeviceList.findOne({ randomDeviceId });
        if (userDeviceList) {
            // Update user device list
            await ModelUserDeviceList.findOneAndUpdate(
                { randomDeviceId },
                { isExpired: true },
                { new: true }
            );
        }

        // Clear cookie
        res.clearCookie('randomDeviceId');

        return res.json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// change password - logged in
router.post(
    '/change-password-logged-in',
    middlewareUserAuth,
    [
        body('oldPassword').custom((value) => {
            if (!value) {
                throw new Error('Old password is required');
            }
            if (typeof value !== 'string') {
                throw new Error('Old password must be a string');
            }
            return true;
        }),
        body('newPassword').custom((value) => {
            if (!value) {
                throw new Error('New password is required');
            }
            if (typeof value !== 'string') {
                throw new Error('New password must be a string');
            }
            if (value.length < 8) {
                throw new Error('New password must be at least 8 characters long');
            }
            return true;
        }),
    ],
    middlewareExpressValidator,
    middlewareActionDatetime,
    async (req: Request, res: Response) => {
        const { auth_username } = res.locals;

        try {
            const { oldPassword, newPassword } = req.body;

            // Find user by username
            const user = await ModelUser.findOne({ username: auth_username }).select('+password');
            if (!user) {
                return res.status(400).json({ message: 'Invalid username or password' });
            }

            // Check old password
            const isMatch = await bcrypt.compare(oldPassword, user.password);

            if (!isMatch) {
                return res.status(400).json({ message: 'Invalid old password' });
            }

            // Hash new password
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            // Update user password
            await ModelUser.findOneAndUpdate(
                { username: auth_username },
                { password: hashedPassword },
                { new: true }
            );

            // send mail
            const userApiKey = await ModelUserApiKey.findOne({ username: auth_username });
            if (userApiKey) {
                if (user.emailVerified && userApiKey.smtpValid) {
                    try {
                        let currentDateTime = new Date();
                        let actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);

                        let text = `Hello from AI Notes XYZ.  \n`;
                        text += `Your password has been changed successfully.  \n`;
                        text += `Ip address: ${actionDatetimeObj.createdAtIpAddress}  \n`;
                        text += `User agent: ${actionDatetimeObj.createdAtUserAgent}  \n`;
                        text += `Time: ${currentDateTime.toISOString()} UTC.  \n`;
                        if (user.timeZoneUtcOffset) {
                            const luxonDate = DateTime.now().toUTC().plus({ minutes: user.timeZoneUtcOffset });
                            const formattedDate = luxonDate.toFormat('EEE MMM dd yyyy HH:mm:ss');
                            text += `Time (${user.timeZoneRegion}): ${formattedDate}. \n`;
                        }
                        text += `If this was not you, please secure your account immediately.  \n`;
                        text += `Thank you for using AI Notes XYZ.`;

                        const sendStatus = await funcSendMail({
                            username: auth_username,
                            smtpTo: user.email,
                            subject: 'AI Notes XYZ - Password Changed',
                            text,
                        });
                        console.log('sendStatus: ', sendStatus);
                    } catch (error) {
                        console.error(error);
                    }
                }
            }

            return res.json({ message: 'Password changed successfully' });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;