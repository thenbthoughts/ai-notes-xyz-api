import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUserDeviceList } from '../../schema/SchemaUserDeviceList.schema';

const router = Router();

// Get User Login History API
router.post('/userLoginHistory', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // args
        let page = 1;
        let perPage = 10;

        // set arg -> page
        if (typeof req.body?.page === 'number') {
            if (req.body.page >= 1) {
                page = req.body.page;
            }
        }
        // set arg -> perPage
        if (typeof req.body?.perPage === 'number') {
            if (req.body.perPage >= 1) {
                perPage = req.body.perPage;
            }
        }

        // mongodb pipeline
        let tempStage = {} as PipelineStage;
        const pipelineDocument: PipelineStage[] = [];
        const pipelineCount: PipelineStage[] = [];

        // stage -> match -> auth
        tempStage = {
            $match: {
                username: res.locals.auth_username,
            }
        };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // stage -> sort -> createdAt
        tempStage = {
            $sort: {
                createdAt: -1,
            },
        };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // stage -> skip
        tempStage = {
            $skip: (page - 1) * perPage,
        };
        pipelineDocument.push(tempStage);

        // stage -> limit
        tempStage = {
            $limit: perPage,
        };
        pipelineDocument.push(tempStage);

        // stageCount -> count
        pipelineCount.push({
            $count: 'count'
        });

        const userDeviceList = await ModelUserDeviceList.aggregate(pipelineDocument);
        const userDeviceListCount = await ModelUserDeviceList.aggregate(pipelineCount);

        let totalCount = 0;
        if (userDeviceListCount.length === 1) {
            if (userDeviceListCount[0].count) {
                totalCount = userDeviceListCount[0].count;
            }
        }

        for (let index = 0; index < userDeviceList.length; index++) {
            const element = userDeviceList[index];
            userDeviceList[index].randomDeviceId = element.randomDeviceId.substring(0, 10);
        }

        return res.json({
            message: 'User device list retrieved successfully',
            count: totalCount,
            docs: userDeviceList,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Clear All Records
router.delete('/clear-all-records', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { auth_username } = res.locals;

        // Delete all user device list records for the authenticated user
        const result = await ModelUserDeviceList.deleteMany({ username: auth_username });

        return res.json({
            message: 'All login history records cleared successfully',
            deletedCount: result.deletedCount,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Logout All Devices
router.post('/logout-all-devices', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const { auth_username } = res.locals;

        // Mark all user device list records as expired for the authenticated user
        const result = await ModelUserDeviceList.updateMany(
            { username: auth_username },
            { isExpired: true }
        );

        return res.json({
            message: 'All devices logged out successfully',
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});


export default router;