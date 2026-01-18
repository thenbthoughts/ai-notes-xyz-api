import mongoose from 'mongoose';
import { PipelineStage } from 'mongoose';

import { getMongodbObjectOrNull } from '../common/getMongodbObjectOrNull';

import { IGlobalSearch } from '../../types/typesSchema/typesGlobalSearch/SchemaGlobalSearch.types';
import { ModelGlobalSearch } from '../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';

import { ModelChatLlm } from '../../schema/schemaChatLlm/SchemaChatLlm.schema';
import { IChatLlm } from '../../types/typesSchema/typesChatLlm/SchemaChatLlm.types';
import { IChatLlmThread } from '../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types';
import { ISchemaCommentCommon } from '../../types/typesSchema/typesSchemaCommentCommon/schemaCommentCommonList.types';
import { IFaq } from '../../types/typesSchema/typesFaq/SchemaFaq.types';
import { ILlmContextKeyword } from '../../types/typesSchema/typesLlmContext/SchemaLlmContextKeyword.types';

export const funcSearchReindexChatLlmById = async ({
    recordId,
}: {
    recordId: string;
}): Promise<IGlobalSearch | null> => {
    interface IChatLlmAggregate extends IChatLlm {
        _id: mongoose.Types.ObjectId;
        username: string;
        thread: IChatLlmThread[];
        comments: ISchemaCommentCommon[];
        aiContextFaq: IFaq[];
        aiContextKeywords: ILlmContextKeyword[];
    }

    try {
        const pipelineDocument = [
            { $match: { _id: getMongodbObjectOrNull(recordId) } },
            {
                $lookup: {
                    from: 'chatLlmThread',
                    localField: 'threadId',
                    foreignField: '_id',
                    as: 'thread',
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

        const chatLlmAggArr = await ModelChatLlm.aggregate(pipelineDocument) as IChatLlmAggregate[];
        const chatLlm = chatLlmAggArr[0];

        if (!chatLlm) {
            return null;
        }

        const textParts: string[] = [];

        // Main content
        if (chatLlm.content) textParts.push(chatLlm.content.toLowerCase());
        if (chatLlm.reasoningContent) textParts.push(chatLlm.reasoningContent.toLowerCase());

        // Type and visibility
        if (chatLlm.type) textParts.push(chatLlm.type.toLowerCase());
        if (chatLlm.visibility) textParts.push(chatLlm.visibility.toLowerCase());

        // Tags
        if (Array.isArray(chatLlm.tags)) {
            textParts.push(...chatLlm.tags.map((tag: string) => tag.toLowerCase()));
        }
        if (Array.isArray(chatLlm.tagsAutoAi)) {
            textParts.push(...chatLlm.tagsAutoAi.map((tag: string) => tag.toLowerCase()));
        }

        // File content
        if (chatLlm.fileContentText) textParts.push(chatLlm.fileContentText.toLowerCase());
        if (chatLlm.fileContentAi) textParts.push(chatLlm.fileContentAi.toLowerCase());

        // AI model information
        if (chatLlm.aiModelName) textParts.push(chatLlm.aiModelName.toLowerCase());
        if (chatLlm.aiModelProvider) textParts.push(chatLlm.aiModelProvider.toLowerCase());

        // Thread information
        if (Array.isArray(chatLlm.thread) && chatLlm.thread.length > 0) {
            let thread = chatLlm.thread[0];
            if (thread) {
                if (thread.threadTitle) textParts.push(thread.threadTitle.toLowerCase());
                if (Array.isArray(thread.tagsAi)) {
                    textParts.push(...thread.tagsAi.map((tag: string) => tag.toLowerCase()));
                }
                if (thread.aiSummary) textParts.push(thread.aiSummary.toLowerCase());
                if (thread.systemPrompt) textParts.push(thread.systemPrompt.toLowerCase());
                if (thread.isFavourite) {
                    textParts.push('favorite');
                    textParts.push('starred');
                    textParts.push('important');
                }
            }
        }

        // comments
        if (Array.isArray(chatLlm.comments) && chatLlm.comments.length > 0) {
            for (const comment of chatLlm.comments) {
                if (typeof comment?.commentText === 'string') {
                    textParts.push(comment?.commentText?.toLowerCase());
                }
            }
        }

        // ai keywords
        if (Array.isArray(chatLlm.aiContextKeywords) && chatLlm.aiContextKeywords.length > 0) {
            for (const keyword of chatLlm.aiContextKeywords) {
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
        if (Array.isArray(chatLlm.aiContextFaq) && chatLlm.aiContextFaq.length > 0) {
            for (const faq of chatLlm.aiContextFaq) {
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

        const searchableText = textParts
            .map((part: string) => part.trim())
            .filter((part: string) => part.length > 0)
            .map((part: string) => part.toLowerCase().replace(/\s+/g, ' ').replace(/\n/g, ''))
            .join(' ');

        // delete many
        await ModelGlobalSearch.deleteMany({
            entityId: chatLlm._id,
        });

        // insert new record
        await ModelGlobalSearch.create({
            entityId: chatLlm._id,
            username: chatLlm.username,
            text: searchableText,
            collectionName: 'chatLlm',
            chatLlmThreadId: chatLlm.threadId,
            updatedAtUtc: chatLlm.updatedAtUtc || new Date(),

            rawData: {
                chatLlm,
            }
        });

        return null;
    } catch (error) {
        console.error('Error getting insert object from chat llm:', error);
        return null;
    }
};