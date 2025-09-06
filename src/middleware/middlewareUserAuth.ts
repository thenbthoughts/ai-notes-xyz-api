import { Request, Response, NextFunction } from 'express';

import {
    ModelUser
} from '../schema/schemaUser/SchemaUser.schema';
import {
    ModelUserDeviceList
} from '../schema/schemaUser/SchemaUserDeviceList.schema';
import { ModelUserApiKey } from '../schema/schemaUser/SchemaUserApiKey.schema';
import { getApiKeyByObject } from '../utils/llm/llmCommonFunc';

const middlewareUserAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const randomDeviceId = req.headers['authorization']?.split(' ')[1];
        if (!randomDeviceId) {
            return res.status(401).json({ message: 'No token provided' });
        }

        // Find user device list by random device id
        const userDeviceList = await ModelUserDeviceList.findOne({ randomDeviceId });
        if (!userDeviceList) {
            return res.status(400).json({ message: 'Invalid device id' });
        }

        // if user device list is expired
        if (userDeviceList.isExpired) {
            return res.status(400).json({ message: 'Device list is expired' });
        }

        // if user agent is not match
        if (userDeviceList.userAgent !== req.headers['user-agent']) {
            // update user device list
            await ModelUserDeviceList.updateOne(
                {
                    randomDeviceId: randomDeviceId,
                },
                {
                    isExpired: true,
                }
            )
            return res.status(400).json({ message: 'User agent is not match' });
        }

        // Find user by username
        const user = await ModelUser.findOne({ username: userDeviceList.username });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        // Set user in request
        res.locals.auth_username = user.username;
        if(typeof user.timeZoneUtcOffset === 'number') {
            res.locals.timeZoneUtcOffset = user.timeZoneUtcOffset;
        } else {
            res.locals.timeZoneUtcOffset = 0;
        }

        const resultApiKey = await ModelUserApiKey.findOne({
            username: user.username
        });
        const apiKey = getApiKeyByObject(resultApiKey);
        res.locals.apiKey = apiKey;

        next();
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
};

export default middlewareUserAuth;


