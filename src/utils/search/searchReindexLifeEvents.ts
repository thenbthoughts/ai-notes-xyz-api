import mongoose from 'mongoose';
import { PipelineStage } from 'mongoose';

import { getMongodbObjectOrNull } from '../common/getMongodbObjectOrNull';

import { IGlobalSearch } from '../../types/typesSchema/typesGlobalSearch/SchemaGlobalSearch.types';
import { ModelGlobalSearch } from '../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';

import { ModelLifeEvents } from '../../schema/schemaLifeEvents/SchemaLifeEvents.schema';
import { ILifeEvents } from '../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types';
import { ILifeEventCategory } from '../../types/typesSchema/typesLifeEvents/SchemaLifeEventCategory.types';
import { ISchemaCommentCommon } from '../../types/typesSchema/typesSchemaCommentCommon/schemaCommentCommonList.types';
import { IFaq } from '../../types/typesSchema/typesFaq/SchemaFaq.types';
import { ILlmContextKeyword } from '../../types/typesSchema/typesLlmContext/SchemaLlmContextKeyword.types';

export const funcSearchReindexLifeEventsById = async ({
    recordId,
}: {
    recordId: string;
}): Promise<IGlobalSearch | null> => {
    interface ILifeEventAggregate extends ILifeEvents {
        _id: mongoose.Types.ObjectId;
        username: string;
        category: ILifeEventCategory[];
        categorySub: ILifeEventCategory[];
        comments: ISchemaCommentCommon[];
        aiContextFaq: IFaq[];
        aiContextKeywords: ILlmContextKeyword[];
    }

    try {
        const pipelineDocument = [
            { $match: { _id: getMongodbObjectOrNull(recordId) } },
            {
                $lookup: {
                    from: 'lifeEventCategory',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category',
                }
            },
            {
                $lookup: {
                    from: 'lifeEventCategory',
                    localField: 'categorySubId',
                    foreignField: '_id',
                    as: 'categorySub',
                }
            },
            {
                $lookup: {
                    from: 'commentsCommon',
                    localField: '_id',
                    foreignField: 'entityId',
                    as: 'comments',
                }
            },
            {
                $lookup: {
                    from: 'aiFaq',
                    localField: '_id',
                    foreignField: 'metadataSourceId',
                    as: 'aiContextFaq',
                }
            },
            {
                $lookup: {
                    from: 'llmContextKeyword',
                    localField: '_id',
                    foreignField: 'metadataSourceId',
                    as: 'aiContextKeywords',
                }
            },
            { $limit: 1 }
        ] as PipelineStage[];

        const lifeEventAggArr = await ModelLifeEvents.aggregate(pipelineDocument) as ILifeEventAggregate[];
        const lifeEvent = lifeEventAggArr[0];

        if (!lifeEvent) {
            return null;
        }

        const textParts: string[] = [];
        if (lifeEvent.title) textParts.push(lifeEvent.title.toLowerCase());
        if (lifeEvent.description) textParts.push(lifeEvent.description.toLowerCase());
        if (lifeEvent.aiSummary) textParts.push(lifeEvent.aiSummary.toLowerCase());
        if (lifeEvent.aiSuggestions) textParts.push(lifeEvent.aiSuggestions.toLowerCase());
        if (lifeEvent.isStar) {
            if (typeof lifeEvent.isStar === 'boolean') {
                textParts.push('star');
                textParts.push('important');
            }
        }
        if (lifeEvent.eventImpact !== 'very-low') {
            textParts.push(lifeEvent.eventImpact.toLowerCase());
        }
        if (lifeEvent.aiCategory) {
            textParts.push(lifeEvent.aiCategory.toLowerCase());
        }
        if (lifeEvent.aiSubCategory) {
            textParts.push(lifeEvent.aiSubCategory.toLowerCase());
        }
        if (Array.isArray(lifeEvent.tags)) {
            textParts.push(...lifeEvent.tags.map((tag: string) => tag.toLowerCase()));
        }
        if (Array.isArray(lifeEvent.aiTags)) {
            textParts.push(...lifeEvent.aiTags.map((tag: string) => tag.toLowerCase()));
        }

        // Event date information for searching by year/month
        if (lifeEvent.eventDateYearStr) {
            textParts.push(lifeEvent.eventDateYearStr); // e.g., "2024"
        }
        if (lifeEvent.eventDateYearMonthStr) {
            textParts.push(lifeEvent.eventDateYearMonthStr); // e.g., "2024-01"
        }

        // category
        if (Array.isArray(lifeEvent.category) && lifeEvent.category.length > 0) {
            let categoryObj = lifeEvent.category[0];
            if (categoryObj) {
                if (typeof categoryObj?.name === 'string') {
                    textParts.push(categoryObj.name.toLowerCase());
                }
            }
        }

        // sub category
        if (Array.isArray(lifeEvent.categorySub) && lifeEvent.categorySub.length > 0) {
            let categorySubObj = lifeEvent.categorySub[0];
            if (categorySubObj) {
                if (typeof categorySubObj?.name === 'string') {
                    textParts.push(categorySubObj.name.toLowerCase());
                }
            }
        }

        // ai keywords
        if (Array.isArray(lifeEvent.aiContextKeywords) && lifeEvent.aiContextKeywords.length > 0) {
            for (const keyword of lifeEvent.aiContextKeywords) {
                if (typeof keyword?.keyword === 'string' && keyword.keyword) {
                    textParts.push(keyword.keyword.toLowerCase());
                }
                if (typeof keyword?.aiCategory === 'string' && keyword.aiCategory) {
                    textParts.push(keyword.aiCategory.toLowerCase());
                }
                if (typeof keyword?.aiSubCategory === 'string' && keyword.aiSubCategory) {
                    textParts.push(keyword.aiSubCategory.toLowerCase());
                }
                if (typeof keyword?.aiTopic === 'string' && keyword.aiTopic) {
                    textParts.push(keyword.aiTopic.toLowerCase());
                }
                if (typeof keyword?.aiSubTopic === 'string' && keyword.aiSubTopic) {
                    textParts.push(keyword.aiSubTopic.toLowerCase());
                }
            }
        }

        // ai faq
        if (Array.isArray(lifeEvent.aiContextFaq) && lifeEvent.aiContextFaq.length > 0) {
            for (const faq of lifeEvent.aiContextFaq) {
                if (typeof faq?.question === 'string') {
                    textParts.push(faq.question.toLowerCase());
                }
                if (typeof faq?.answer === 'string') {
                    textParts.push(faq.answer.toLowerCase());
                }
                if (typeof faq?.aiCategory === 'string' && faq.aiCategory) {
                    textParts.push(faq.aiCategory.toLowerCase());
                }
                if (typeof faq?.aiSubCategory === 'string' && faq.aiSubCategory) {
                    textParts.push(faq.aiSubCategory.toLowerCase());
                }
                if (Array.isArray(faq?.tags)) {
                    textParts.push(...faq.tags.filter((tag: string) => typeof tag === 'string').map((tag: string) => tag.toLowerCase()));
                }
            }
        }

        // comments
        if (Array.isArray(lifeEvent.comments) && lifeEvent.comments.length > 0) {
            for (const comment of lifeEvent.comments) {
                if (typeof comment?.commentText === 'string') {
                    textParts.push(comment?.commentText?.toLowerCase());
                }
            }
        }

        const searchableText = textParts
            .map((part: string) => part.trim())
            .filter((part: string) => part.length > 0)
            .map((part: string) => part.toLowerCase().replace(/\s+/g, ' ').replace(/\n/g, ''))
            .join(' ');

        // delete many
        await ModelGlobalSearch.deleteMany({
            entityId: lifeEvent._id,
        });

        let isDiary = false;
        if (lifeEvent.title && /(Daily|Weekly|Monthly) Summary by AI/i.test(lifeEvent.title)) {
            isDiary = true;
        }

        // insert new record
        await ModelGlobalSearch.create({
            entityId: lifeEvent._id,
            username: lifeEvent.username,
            text: searchableText,
            collectionName: 'lifeEvents',
            lifeEventIsDiary: isDiary,
            updatedAtUtc: lifeEvent.updatedAtUtc || new Date(),

            rawData: {
                lifeEvent,
            }
        });

        return null;
    } catch (error) {
        console.error('Error getting insert object from life event:', error);
        return null;
    }
};