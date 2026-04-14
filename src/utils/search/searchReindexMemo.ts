import mongoose from 'mongoose';
import type { PipelineStage } from 'mongoose';

import { getMongodbObjectOrNull } from '../common/getMongodbObjectOrNull';

import type { IGlobalSearch } from '../../types/typesSchema/typesGlobalSearch/SchemaGlobalSearch.types';
import { ModelGlobalSearch } from '../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';
import { ModelMemoNote } from '../../schema/schemaMemo/SchemaMemoNote.schema';
import type { IMemoNote } from '../../types/typesSchema/typesSchemaMemo/SchemaMemoNote.types';

export const funcSearchReindexMemoById = async ({
    recordId,
}: {
    recordId: string;
}): Promise<IGlobalSearch | null> => {
    interface IMemoAgg extends IMemoNote {
        _id: mongoose.Types.ObjectId;
        username: string;
        memoLabels: { name?: string }[];
    }

    try {
        const pipelineDocument = [
            { $match: { _id: getMongodbObjectOrNull(recordId) } },
            {
                $lookup: {
                    from: 'memoLabels',
                    localField: 'labelIds',
                    foreignField: '_id',
                    as: 'memoLabels',
                },
            },
            { $limit: 1 },
        ] as PipelineStage[];

        const idObj = getMongodbObjectOrNull(recordId);
        if (!idObj) {
            return null;
        }

        const memoAggArr = await ModelMemoNote.aggregate(pipelineDocument) as IMemoAgg[];
        const memo = memoAggArr[0];

        await ModelGlobalSearch.deleteMany({
            entityId: idObj,
        });

        if (!memo || memo.trashed) {
            return null;
        }

        const textParts: string[] = [];
        if (memo.title) textParts.push(memo.title.toLowerCase());
        if (memo.body) textParts.push(memo.body.toLowerCase());
        if (memo.pinned) {
            textParts.push('pinned', 'important');
        }
        if (memo.archived) {
            textParts.push('archived');
        }
        if (Array.isArray(memo.memoLabels)) {
            for (const lbl of memo.memoLabels) {
                if (typeof lbl?.name === 'string' && lbl.name.trim()) {
                    textParts.push(lbl.name.toLowerCase());
                }
            }
        }

        const searchableText = textParts
            .map((part: string) => part.trim())
            .filter((part: string) => part.length > 0)
            .map((part: string) => part.toLowerCase().replace(/\s+/g, ' ').replace(/\n/g, ' '))
            .join(' ');

        await ModelGlobalSearch.create({
            entityId: memo._id,
            username: memo.username,
            text: searchableText,
            collectionName: 'memoNotes',
            updatedAtUtc: memo.updatedAtUtc || new Date(),
            rawData: { memo },
        });

        return null;
    } catch (error) {
        console.error('Error reindexing memo for global search:', error);
        return null;
    }
};
