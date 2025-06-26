import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelInfoVaultAddress } from '../../schema/schemaInfoVault/SchemaInfoVaultAddress.schema';
import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';

const router = Router();

// Get InfoVault Address API
router.post('/infoVaultAddressGet', middlewareUserAuth, async (req: Request, res: Response) => {
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
                            { address: { $regex: elementStr, $options: 'i' } },
                            { city: { $regex: elementStr, $options: 'i' } },
                            { state: { $regex: elementStr, $options: 'i' } },
                            { countryRegion: { $regex: elementStr, $options: 'i' } },
                            { pincode: { $regex: elementStr, $options: 'i' } },
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

        const infoVaultAddress = await ModelInfoVaultAddress.aggregate(pipelineDocument);
        const infoVaultAddressCount = await ModelInfoVaultAddress.aggregate(pipelineCount);

        let totalCount = 0;
        if (infoVaultAddressCount.length === 1) {
            if (infoVaultAddressCount[0].count) {
                totalCount = infoVaultAddressCount[0].count;
            }
        }

        return res.json({
            message: 'InfoVault Address retrieved successfully',
            count: totalCount,
            docs: infoVaultAddress,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete InfoVault Address API
router.post('/infoVaultAddressDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'InfoVault Address ID cannot be null' });
        }

        const infoVaultAddress = await ModelInfoVaultAddress.findOneAndDelete({
            _id: _id,
            username: res.locals.auth_username,
        });

        if (!infoVaultAddress) {
            return res.status(404).json({ message: 'InfoVault Address not found or unauthorized' });
        }

        return res.json({ message: 'InfoVault Address deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Add InfoVault Address API
router.post('/infoVaultAddressAdd', middlewareUserAuth, async (req: Request, res: Response) => {
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
        const newInfoVaultAddress = await ModelInfoVaultAddress.create({
            infoVaultId: infoVaultId,
            username: res.locals.auth_username,
            countryRegion: req.body.countryRegion || '',
            address: req.body.address || '',
            city: req.body.city || '',
            pincode: req.body.pincode || '',
            state: req.body.state || '',
            poBox: req.body.poBox || '',
            label: req.body.label || 'home',
            createdAtUtc: now,
            createdAtIpAddress: req.ip || '',
            createdAtUserAgent: req.headers['user-agent'] || '',
            updatedAtUtc: now,
            updatedAtIpAddress: req.ip || '',
            updatedAtUserAgent: req.headers['user-agent'] || '',
        });

        return res.json({
            message: 'InfoVault Address added successfully',
            doc: newInfoVaultAddress,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Edit InfoVault Address API
router.post('/infoVaultAddressEdit', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let _id = null as mongoose.Types.ObjectId | null;
        const arg_id = req.body._id;
        if (typeof arg_id === 'string') {
            _id = arg_id ? mongoose.Types.ObjectId.createFromHexString(arg_id) : null;
        }
        if (_id === null) {
            return res.status(400).json({ message: 'InfoVault Address ID cannot be null' });
        }

        const updateObj = {} as any;
        if (typeof req.body.countryRegion === 'string') {
            updateObj.countryRegion = req.body.countryRegion;
        }
        if (typeof req.body.address === 'string') {
            updateObj.address = req.body.address;
        }
        if (typeof req.body.city === 'string') {
            updateObj.city = req.body.city;
        }
        if (typeof req.body.pincode === 'string') {
            updateObj.pincode = req.body.pincode;
        }
        if (typeof req.body.state === 'string') {
            updateObj.state = req.body.state;
        }
        if (typeof req.body.poBox === 'string') {
            updateObj.poBox = req.body.poBox;
        }
        if (typeof req.body.label === 'string') {
            updateObj.label = req.body.label;
        }
        updateObj.updatedAtUtc = new Date();
        updateObj.updatedAtIpAddress = req.ip || '';
        updateObj.updatedAtUserAgent = req.headers['user-agent'] || '';

        if (Object.keys(updateObj).length >= 1) {
            await ModelInfoVaultAddress.updateOne(
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
            message: 'InfoVault Address edited successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router; 