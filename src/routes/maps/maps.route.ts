import mongoose, { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelRecordEmptyTable } from '../../schema/schemaOther/NoRecordTable';

// Router
const router = Router();

const getMapsLocationInfoVault = ({
    username,
}: {
    username: string;
}) => {
    type PipelineStageCustom = PipelineStage.Match | PipelineStage.AddFields | PipelineStage.Lookup | PipelineStage.Project | PipelineStage.Unwind | PipelineStage.Set;

    let tempStage = {} as PipelineStageCustom;
    const stateDocument = [] as PipelineStageCustom[];

    // stateDocument -> match
    tempStage = {
        $match: {
            username: username,
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> lookup -> infoVault
    tempStage = {
        $lookup: {
            from: 'infoVaultAddress',
            localField: '_id',
            foreignField: 'infoVaultId',
            as: 'infoVaultAddressObj',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> unwind -> infoVaultAddressObj
    tempStage = {
        $unwind: {
            path: '$infoVaultAddressObj'
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> addFields -> infoVaultAddress
    tempStage = {
        $addFields: {
            infoVaultAddress: []
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> set -> infoVaultAddress
    tempStage = {
        $set: {
            infoVaultAddress: {
                $cond: [
                    {
                        $ifNull: [
                            '$infoVaultAddressObj',
                            false
                        ]
                    },
                    {
                        $concatArrays: [
                            ['$infoVaultAddressObj']
                        ]
                    },
                    []
                ]
            }
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> addFields -> size -> infoVaultAddress
    tempStage = {
        $addFields: {
            sizeInfoVaultAddress: { $size: '$infoVaultAddress' },
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> match -> sizeInfoVaultAddress > 0
    tempStage = {
        $match: {
            sizeInfoVaultAddress: {
                $gt: 0
            },
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> addFields -> fromCollection
    tempStage = {
        $addFields: {
            fromCollection: 'infoVault',
        }
    };
    stateDocument.push(tempStage);

    // stateDocument -> project
    tempStage = {
        $project: {
            _id: 1,
            fromCollection: 1,
            lifeEvents: "$$ROOT"
        }
    };
    stateDocument.push(tempStage);

    console.log(JSON.stringify(stateDocument, null, 2));

    return stateDocument;
}

// Get MapsAPI
router.post(
    '/mapsLocationsGet',
    middlewareUserAuth,
    async (req: Request, res: Response) => {
        try {
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

            let tempStage = {} as PipelineStage;
            const stateDocument = [] as PipelineStage[];

            // stateDocument -> unionWith
            tempStage = {
                $unionWith: {
                    coll: 'infoVault',
                    pipeline: getMapsLocationInfoVault({
                        username: res.locals.auth_username,
                    }),
                }
            };
            stateDocument.push(tempStage);

            // stateDocument -> skip
            tempStage = {
                $skip: (page - 1) * perPage,
            };
            stateDocument.push(tempStage);

            // stateDocument -> limit
            tempStage = {
                $limit: perPage,
            };
            stateDocument.push(tempStage);

            // pipeline
            const resultRecordEmptyTable = await ModelRecordEmptyTable.aggregate(stateDocument);

            return res.json({
                message: 'Maps retrieved successfully',
                count: resultRecordEmptyTable.length,
                docs: resultRecordEmptyTable,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;