import { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUserNotification } from '../../schema/schemaUser/SchemaUserNotification';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';

const router = Router();

// Get User Notifications API
router.post('/userNotificationGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let tempStage = {} as PipelineStage;
        const pipelineDocument: PipelineStage[] = [];
        const pipelineCount: PipelineStage[] = [];

        // args
        let page = 1;
        let perPage = 100;

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

        // stage -> match -> auth
        tempStage = {
            $match: {
                username: res.locals.auth_username,
            }
        };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // stage -> sort -> createdAtUtc
        tempStage = {
            $sort: {
                createdAtUtc: -1,
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

        const userNotifications = await ModelUserNotification.aggregate(pipelineDocument);
        const userNotificationsCount = await ModelUserNotification.aggregate(pipelineCount);

        let totalCount = 0;
        if (userNotificationsCount.length === 1) {
            if (userNotificationsCount[0].count) {
                totalCount = userNotificationsCount[0].count;
            }
        }

        return res.json({
            message: 'User notifications retrieved successfully',
            count: totalCount,
            docs: userNotifications,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete User Notification API
router.post('/userNotificationDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const username = res.locals.auth_username;
        const { recordId } = req.body;

        let recordIdObj = getMongodbObjectOrNull(recordId);

        if (recordIdObj === null) {
            return res.status(400).json({ message: 'Valid record ID is required' });
        }

        const deletedUserNotification = await ModelUserNotification.deleteOne({ _id: recordIdObj, username: username });
        if (deletedUserNotification.deletedCount === 0) {
            return res.status(404).json({ message: 'User notification not found' });
        }

        return res.json({
            message: 'User notification deleted successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;