import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import middlewareActionDatetime from '../../middleware/middlewareActionDatetime';
import { ModelUserMemory } from '../../schema/schemaUser/SchemaUserMemory.schema';
import { normalizeDateTimeIpAddress } from '../../utils/llm/normalizeDateTimeIpAddress';
import { getMongodbObjectOrNull } from '../../utils/common/getMongodbObjectOrNull';
import { ModelUser } from '../../schema/schemaUser/SchemaUser.schema';

const router = Router();

// Get Memory API
router.post('/memoryGet', middlewareUserAuth, async (req: Request, res: Response) => {
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

        // stage -> match -> recordId
        const arg_recordId = req.body.recordId;
        if (typeof arg_recordId === 'string') {
            if (arg_recordId.length === 24) {
                const _id = getMongodbObjectOrNull(arg_recordId);
                if (_id) {
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

        // stage -> match -> isPermanent
        if (typeof req.body?.isPermanent === 'boolean') {
            tempStage = {
                $match: {
                    isPermanent: req.body.isPermanent,
                }
            };
            pipelineDocument.push(tempStage);
            pipelineCount.push(tempStage);
        }

        // stage -> add computed field for sorting (handle null values)
        pipelineDocument.push({
            $addFields: {
                sortDate: {
                    $ifNull: ['$updatedAtUtc', '$createdAtUtc']
                }
            }
        });
        
        // stage -> sort by computed date descending
        tempStage = {
            $sort: {
                sortDate: -1,
            }
        };
        pipelineDocument.push(tempStage);
        
        // stage -> remove computed field
        pipelineDocument.push({
            $project: {
                sortDate: 0
            }
        });

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

        // get documents
        let docs = [];
        try {
            docs = await ModelUserMemory.aggregate(pipelineDocument);
        } catch (aggregateError) {
            console.error('Error in memoryGet aggregate:', aggregateError);
            // Fallback to simple find if aggregate fails
            docs = await ModelUserMemory.find({
                username: res.locals.auth_username,
            })
                .sort({ updatedAtUtc: -1, createdAtUtc: -1 })
                .skip((page - 1) * perPage)
                .limit(perPage)
                .lean();
        }

        // get count
        let total = 0;
        try {
            pipelineCount.push({
                $count: 'total',
            });
            const countResult = await ModelUserMemory.aggregate(pipelineCount);
            total = countResult.length > 0 ? (countResult[0].total || 0) : 0;
        } catch (countError) {
            console.error('Error in memoryGet count:', countError);
            // Fallback to countDocuments
            total = await ModelUserMemory.countDocuments({
                username: res.locals.auth_username,
            });
        }

        return res.json({
            docs: docs || [],
            total: total,
            page: page,
            perPage: perPage,
        });
    } catch (error) {
        console.error('Error in memoryGet:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error details:', errorMessage);
        return res.status(500).json({ 
            message: 'Server error', 
            error: errorMessage 
        });
    }
});

// Add Memory API
router.post('/memoryAdd', middlewareUserAuth, middlewareActionDatetime, async (req: Request, res: Response) => {
    try {
        const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);

        const { content, isPermanent } = req.body;

        if (typeof content !== 'string' || content.trim().length === 0) {
            return res.status(400).json({ message: 'Content is required' });
        }

        // Check memory limit (only for non-permanent memories)
        const user = await ModelUser.findOne({ username: res.locals.auth_username });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const userMemoriesLimit = user.userMemoriesLimit || 15;
        
        // Only count non-permanent memories towards the limit
        const currentNonPermanentCount = await ModelUserMemory.countDocuments({
            username: res.locals.auth_username,
            isPermanent: false,
        });

        // If creating a non-permanent memory and limit exceeded, delete oldest non-permanent memories
        const willBePermanent = typeof isPermanent === 'boolean' ? isPermanent : false;
        if (!willBePermanent && currentNonPermanentCount >= userMemoriesLimit) {
            const memoriesToDelete = await ModelUserMemory.find({
                username: res.locals.auth_username,
                isPermanent: false,
            })
                .sort({ updatedAtUtc: 1, createdAtUtc: 1 }) // oldest first
                .limit(currentNonPermanentCount - userMemoriesLimit + 1); // delete enough to make room

            if (memoriesToDelete.length > 0) {
                const idsToDelete = memoriesToDelete.map(m => m._id);
                await ModelUserMemory.deleteMany({ _id: { $in: idsToDelete } });
            }
        }

        const newMemory = await ModelUserMemory.create({
            username: res.locals.auth_username,
            content: content.trim(),
            isPermanent: typeof isPermanent === 'boolean' ? isPermanent : false,
            ...actionDatetimeObj,
        });

        return res.status(201).json({
            message: 'Memory added successfully',
            doc: newMemory,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Update Memory API
router.post('/memoryUpdate', middlewareUserAuth, middlewareActionDatetime, async (req: Request, res: Response) => {
    try {
        const actionDatetimeObj = normalizeDateTimeIpAddress(res.locals.actionDatetime);

        const arg_id = req.body._id;
        if (typeof arg_id !== 'string' || arg_id.length !== 24) {
            return res.status(400).json({ message: 'Memory ID is required' });
        }

        const _id = getMongodbObjectOrNull(arg_id);
        if (!_id) {
            return res.status(400).json({ message: 'Invalid memory ID' });
        }

        // Check if memory exists and belongs to user
        const existingMemory = await ModelUserMemory.findOne({
            _id: _id,
            username: res.locals.auth_username,
        });

        if (!existingMemory) {
            return res.status(404).json({ message: 'Memory not found' });
        }

        const updateObj: {
            content?: string;
            isPermanent?: boolean;
        } = {};

        if (typeof req.body.content === 'string' && req.body.content.trim().length > 0) {
            updateObj.content = req.body.content.trim();
        }

        if (typeof req.body.isPermanent === 'boolean') {
            updateObj.isPermanent = req.body.isPermanent;
        }

        if (Object.keys(updateObj).length === 0) {
            return res.status(400).json({ message: 'No valid fields to update' });
        }

        // If changing from permanent to non-permanent, check memory limit
        if (updateObj.isPermanent === false && existingMemory.isPermanent === true) {
            const user = await ModelUser.findOne({ username: res.locals.auth_username });
            if (user) {
                const userMemoriesLimit = user.userMemoriesLimit || 15;
                const currentNonPermanentCount = await ModelUserMemory.countDocuments({
                    username: res.locals.auth_username,
                    isPermanent: false,
                });

                // If limit exceeded, delete oldest non-permanent memories
                if (currentNonPermanentCount >= userMemoriesLimit) {
                    const memoriesToDelete = await ModelUserMemory.find({
                        username: res.locals.auth_username,
                        isPermanent: false,
                    })
                        .sort({ updatedAtUtc: 1, createdAtUtc: 1 }) // oldest first
                        .limit(currentNonPermanentCount - userMemoriesLimit + 1); // delete enough to make room

                    if (memoriesToDelete.length > 0) {
                        const idsToDelete = memoriesToDelete.map(m => m._id);
                        await ModelUserMemory.deleteMany({ _id: { $in: idsToDelete } });
                    }
                }
            }
        }

        await ModelUserMemory.updateOne(
            {
                _id: _id,
                username: res.locals.auth_username,
            },
            {
                $set: {
                    ...updateObj,
                    updatedAtUtc: actionDatetimeObj.updatedAtUtc,
                    updatedAtIpAddress: actionDatetimeObj.updatedAtIpAddress,
                    updatedAtUserAgent: actionDatetimeObj.updatedAtUserAgent,
                }
            }
        );

        const updatedMemory = await ModelUserMemory.findById(_id);

        return res.json({
            message: 'Memory updated successfully',
            doc: updatedMemory,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Delete Memory API
router.post('/memoryDelete', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const arg_id = req.body._id;
        if (typeof arg_id !== 'string' || arg_id.length !== 24) {
            return res.status(400).json({ message: 'Memory ID is required' });
        }

        const _id = getMongodbObjectOrNull(arg_id);
        if (!_id) {
            return res.status(400).json({ message: 'Invalid memory ID' });
        }

        // Check if memory exists and belongs to user
        const existingMemory = await ModelUserMemory.findOne({
            _id: _id,
            username: res.locals.auth_username,
        });

        if (!existingMemory) {
            return res.status(404).json({ message: 'Memory not found' });
        }

        // Check if memory is permanent (protected)
        if (existingMemory.isPermanent) {
            return res.status(403).json({ message: 'Cannot delete permanent memory' });
        }

        await ModelUserMemory.deleteOne({
            _id: _id,
            username: res.locals.auth_username,
        });

        return res.json({ message: 'Memory deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;
