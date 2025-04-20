import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

import {
    ModelUser
} from '../../schema/SchemaUser.schema';
import {
    ModelUserDeviceList
} from '../../schema/SchemaUserDeviceList.schema';

// Router
const router = Router();

// Login API
router.post('/login', async (req: Request, res: Response) => {
    const { username, password } = req.body;

    try {
        // Find user by username
        const user = await ModelUser.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        // Generate random device id
        const randomDeviceId = crypto.randomBytes(64).toString('hex');

        // Save user device list
        const userDeviceList = await ModelUserDeviceList.create({
            username: user.username,
            randomDeviceId,
            isExpired: false,

            userAgent: req?.headers['user-agent'] || '',
            createdAt: new Date(),
            createdAtIpAddress: req?.ip || '',
            updatedAt: new Date(),
            updatedAtIpAddress: req?.ip || '',
        });

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

export default router;