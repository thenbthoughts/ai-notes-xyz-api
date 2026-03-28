import { PipelineStage } from 'mongoose';
import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelRecordEmptyTable } from '../../schema/schemaOther/NoRecordTable';

// Router
const router = Router();

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildMapsSearchMatch = (raw: string): PipelineStage.Match | null => {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) {
        return null;
    }
    const pattern = escapeRegex(trimmed);
    return {
        $match: {
            $or: [
                { 'lifeEvents.name': { $regex: pattern, $options: 'i' } },
                { 'lifeEvents.notes': { $regex: pattern, $options: 'i' } },
                { 'lifeEvents.nickname': { $regex: pattern, $options: 'i' } },
                { 'lifeEvents.company': { $regex: pattern, $options: 'i' } },
                { 'lifeEvents.infoVaultType': { $regex: pattern, $options: 'i' } },
                { 'lifeEvents.infoVaultAddress.label': { $regex: pattern, $options: 'i' } },
                { 'lifeEvents.infoVaultAddress.address': { $regex: pattern, $options: 'i' } },
                { 'lifeEvents.infoVaultAddress.city': { $regex: pattern, $options: 'i' } },
                { 'lifeEvents.infoVaultAddress.state': { $regex: pattern, $options: 'i' } },
                { 'lifeEvents.infoVaultAddress.countryRegion': { $regex: pattern, $options: 'i' } },
            ],
        },
    };
};

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

    // Skip rows with no usable coordinates (schema defaults lat/lng to 0)
    tempStage = {
        $match: {
            $nor: [
                {
                    $and: [
                        { 'infoVaultAddressObj.latitude': { $in: [0, null] } },
                        { 'infoVaultAddressObj.longitude': { $in: [0, null] } },
                    ],
                },
            ],
        },
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

            const searchRaw =
                typeof req.body?.search === 'string' ? req.body.search : '';

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

            // Ignore any stray rows from the anchor collection that are not map results
            tempStage = {
                $match: {
                    fromCollection: 'infoVault',
                },
            };
            stateDocument.push(tempStage);

            const searchStage = buildMapsSearchMatch(searchRaw);
            if (searchStage) {
                stateDocument.push(searchStage);
            }

            tempStage = {
                $facet: {
                    docs: [
                        { $skip: (page - 1) * perPage },
                        { $limit: perPage },
                    ],
                    countMeta: [{ $count: 'total' }],
                },
            };
            stateDocument.push(tempStage);

            const aggregateResult = await ModelRecordEmptyTable.aggregate(stateDocument);
            const facetRow = aggregateResult[0] as
                | { docs?: unknown[]; countMeta?: { total?: number }[] }
                | undefined;
            const docs = Array.isArray(facetRow?.docs) ? facetRow.docs : [];

            // set totalCount
            let totalCount = 0;
            if (typeof facetRow?.countMeta?.[0]?.total === 'number') {
                totalCount = facetRow.countMeta[0].total;
            } else {
                totalCount = 0;
            }

            return res.json({
                message: 'Maps retrieved successfully',
                count: totalCount,
                docs,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;