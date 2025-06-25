import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelInfoVaultPhone } from '../../schema/schemaInfoVault/SchemaInfoVaultPhone.schema';
import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';

const router = Router();

// Get InfoVault Phone API
router.post('/infoVaultPhoneGet', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let tempStage = {} as PipelineStage;
        const pipelineDocument: PipelineStage[] = [];
        const pipelineCount: PipelineStage[] = [];

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

        // stage -> match -> auth
        tempStage = {
            $match: {
                username: res.locals.auth_username,
            }
        };
        pipelineDocument.push(tempStage);
        pipelineCount.push(tempStage);

        // stage -> match -> recordId
        const arg_recordId = req.body.recordId;
        if (typeof arg_recordId === 'string') {
            if (arg_recordId.length === 24) {
                let _id = null as mongoose.Types.ObjectId | null;
                _id = arg_recordId ? mongoose.Types.ObjectId.createFromHexString(arg_recordId) : null;
                if (_id) {
                    if (_id.toHexString().length === 24) {
                        tempStage = {
                            $match: {
                                _id: _id,
                            }
                        };
                        pipelineDocument.push(tempStage);
                        pipelineCount.push(tempStage);
                    }
                }
            }
        }

        // stage -> match -> infoVaultId
        const arg_infoVaultId = req.body.infoVaultId;
        if (typeof arg_infoVaultId === 'string') {
            if (arg_infoVaultId.length === 24) {
                let infoVaultId = null as mongoose.Types.ObjectId | null;
                infoVaultId = arg_infoVaultId ? mongoose.Types.ObjectId.createFromHexString(arg_infoVaultId) : null;
                if (infoVaultId) {
                    if (infoVaultId.toHexString().length === 24) {
                        tempStage = { $match: { infoVaultId: infoVaultId } };
                        pipelineDocument.push(tempStage);
                        pipelineCount.push(tempStage);
                    }
                }
            }
        }

        // stage -> match -> isPrimary
        if (typeof req.body?.isPrimary === 'string') {
            if (
                req.body?.isPrimary === 'true' ||
                req.body?.isPrimary === 'false'
            ) {
                const isPrimary = req.body?.isPrimary === 'true';
                tempStage = {
                    $match: {
                        isPrimary: isPrimary,
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> search
        if (typeof req.body?.search === 'string') {
            if (req.body.search.length >= 1) {
                let searchQuery = req.body.search as string;

                let searchQueryArr = searchQuery
                    .replace('-', ' ')
                    .split(' ');

                const matchAnd = [];
                for (let index = 0; index < searchQueryArr.length; index++) {
                    const elementStr = searchQueryArr[index];
                    matchAnd.push({
                        $or: [
                            { phoneNumber: { $regex: elementStr, $options: 'i' } },
                            { countryCode: { $regex: elementStr, $options: 'i' } },
                            { label: { $regex: elementStr, $options: 'i' } },
                        ]
                    })
                }

                tempStage = {
                    $match: {
                        $and: [
                            ...matchAnd,
                        ],
                    },
                };
                pipelineDocument.push(tempStage);
                pipelineCount.push(tempStage);
            }
        }

        // stage -> sort -> label
        tempStage = {
            $sort: {
                label: 1,
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

        const infoVaultPhone = await ModelInfoVaultPhone.aggregate(pipelineDocument);
        const infoVaultPhoneCount = await ModelInfoVaultPhone.aggregate(pipelineCount);

        let totalCount = 0;
        if (infoVaultPhoneCount.length === 1) {
            if (infoVaultPhoneCount[0].count) {
                totalCount = infoVaultPhoneCount[0].count;
            }
        }

        return res.json({
            message: 'InfoVault Phone retrieved successfully',
            count: totalCount,
            docs: infoVaultPhone,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete InfoVault Phone API
router.post('/infoVaultPhoneDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'InfoVault Phone ID cannot be null' });
        }

        const infoVaultPhone = await ModelInfoVaultPhone.findOneAndDelete({
            _id: _id,
            username: res.locals.auth_username,
        });

        if (!infoVaultPhone) {
            return res.status(404).json({ message: 'InfoVault Phone not found or unauthorized' });
        }

        return res.json({ message: 'InfoVault Phone deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add InfoVault Phone API
router.post('/infoVaultPhoneAdd', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        // stage -> match -> infoVaultId
        let infoVaultId = null as mongoose.Types.ObjectId | null;
        const arg_infoVaultId = req.body.infoVaultId;
        if (typeof arg_infoVaultId === 'string') {
            if (arg_infoVaultId.length === 24) {
                infoVaultId = arg_infoVaultId ? mongoose.Types.ObjectId.createFromHexString(arg_infoVaultId) : null;
            }
        }
        if (infoVaultId === null) {
            return res.status(400).json({ message: 'InfoVault ID cannot be null' });
        }

        // does infoVault belong to user
        const infoVault = await ModelInfoVault.findOne({
            _id: infoVaultId,
            username: res.locals.auth_username,
        });
        if (!infoVault) {
            return res.status(400).json({ message: 'InfoVault not found or unauthorized' });
        }

        const now = new Date();
        const newInfoVaultPhone = await ModelInfoVaultPhone.create({
            infoVaultId: infoVaultId,
            username: res.locals.auth_username,
            phoneNumber: req.body.phoneNumber || '',
            countryCode: req.body.countryCode || '+1',
            label: req.body.label || 'mobile',
            isPrimary: req.body.isPrimary === true,
            createdAtUtc: now,
            createdAtIpAddress: req.ip || '',
            createdAtUserAgent: req.headers['user-agent'] || '',
            updatedAtUtc: now,
            updatedAtIpAddress: req.ip || '',
            updatedAtUserAgent: req.headers['user-agent'] || '',
        });

        return res.json({
            message: 'InfoVault Phone added successfully',
            doc: newInfoVaultPhone,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Edit InfoVault Phone API
router.post('/infoVaultPhoneEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'InfoVault Phone ID cannot be null' });
        }

        const updateObj = {} as any;
        if (typeof req.body.phoneNumber === 'string') {
            updateObj.phoneNumber = req.body.phoneNumber;
        }
        if (typeof req.body.countryCode === 'string') {
            updateObj.countryCode = req.body.countryCode;
        }
        if (typeof req.body.label === 'string') {
            updateObj.label = req.body.label;
        }
        if (typeof req.body.isPrimary === 'boolean') {
            updateObj.isPrimary = req.body.isPrimary;
        }
        updateObj.updatedAtUtc = new Date();
        updateObj.updatedAtIpAddress = req.ip || '';
        updateObj.updatedAtUserAgent = req.headers['user-agent'] || '';

        if (Object.keys(updateObj).length >= 1) {
            await ModelInfoVaultPhone.updateOne(
                {
                    _id: _id,
                    username: res.locals.auth_username,
                },
                {
                    $set: {
                        ...updateObj,
                    }
                }
            );
        }

        return res.json({
            message: 'InfoVault Phone edited successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router; 