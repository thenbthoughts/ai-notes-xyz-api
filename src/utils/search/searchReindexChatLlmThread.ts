import mongoose from 'mongoose';
import { PipelineStage } from 'mongoose';

import { getMongodbObjectOrNull } from '../common/getMongodbObjectOrNull';

import { IGlobalSearch } from '../../types/typesSchema/typesGlobalSearch/SchemaGlobalSearch.types';
import { ModelGlobalSearch } from '../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';

import { ModelChatLlmThread } from '../../schema/schemaChatLlm/SchemaChatLlmThread.schema';
import { IChatLlmThread } from '../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types';
import { IChatLlm } from '../../types/typesSchema/typesChatLlm/SchemaChatLlm.types';
import { ISchemaCommentCommon } from '../../types/typesSchema/typesSchemaCommentCommon/schemaCommentCommonList.types';
import { IFaq } from '../../types/typesSchema/typesFaq/SchemaFaq.types';
import { ILlmContextKeyword } from '../../types/typesSchema/typesLlmContext/SchemaLlmContextKeyword.types';

export const funcSearchReindexChatLlmThreadById = async ({
    recordId,
}: {
    recordId: string;
}): Promise<IGlobalSearch | null> => {
    interface IChatLlmThreadAggregate extends IChatLlmThread {
        _id: mongoose.Types.ObjectId;
        username: string;
        chatMessages: IChatLlm[];
        comments: ISchemaCommentCommon[];
        aiContextFaq: IFaq[];
        aiContextKeywords: ILlmContextKeyword[];
    }

    try {
        const pipelineDocument = [
            { $match: { _id: getMongodbObjectOrNull(recordId) } },
            {
                $lookup: {
                    from: 'chatLlm',
                    localField: '_id',
                    foreignField: 'threadId',
                    as: 'chatMessages',
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

        const chatLlmThreadAggArr = await ModelChatLlmThread.aggregate(pipelineDocument) as IChatLlmThreadAggregate[];
        const chatLlmThread = chatLlmThreadAggArr[0];

        if (!chatLlmThread) {
            return null;
        }

        const textParts: string[] = [];
        if (chatLlmThread.threadTitle) textParts.push(chatLlmThread.threadTitle.toLowerCase());
        if (chatLlmThread.systemPrompt) textParts.push(chatLlmThread.systemPrompt.toLowerCase());

        // AI information
        if (Array.isArray(chatLlmThread.tagsAi)) {
            textParts.push(...chatLlmThread.tagsAi.map((tag: string) => tag.toLowerCase()));
        }
        if (chatLlmThread.aiSummary) textParts.push(chatLlmThread.aiSummary.toLowerCase());
        if (Array.isArray(chatLlmThread.aiTasks)) {
            textParts.push(...chatLlmThread.aiTasks.map((task: any) => String(task).toLowerCase()));
        }

        // Model information
        if (chatLlmThread.aiModelName) textParts.push(chatLlmThread.aiModelName.toLowerCase());
        if (chatLlmThread.aiModelProvider) textParts.push(chatLlmThread.aiModelProvider.toLowerCase());

        // Classification
        if (chatLlmThread.isFavourite) {
            textParts.push('favorite');
            textParts.push('starred');
            textParts.push('important');
        }

        // chat messages content
        if (Array.isArray(chatLlmThread.chatMessages) && chatLlmThread.chatMessages.length > 0) {
            for (const message of chatLlmThread.chatMessages) {
                // Main message content
                if (message.content) textParts.push(message.content.toLowerCase());
                if (message.reasoningContent) textParts.push(message.reasoningContent.toLowerCase());

                // Message metadata
                if (message.type) textParts.push(message.type.toLowerCase());
                if (message.visibility) textParts.push(message.visibility.toLowerCase());

                // Message tags
                if (Array.isArray(message.tags)) {
                    textParts.push(...message.tags.map((tag: string) => tag.toLowerCase()));
                }
                if (Array.isArray(message.tagsAutoAi)) {
                    textParts.push(...message.tagsAutoAi.map((tag: string) => tag.toLowerCase()));
                }

                // File content from messages
                if (message.fileContentText) textParts.push(message.fileContentText.toLowerCase());
                if (message.fileContentAi) textParts.push(message.fileContentAi.toLowerCase());

                // AI model info from messages
                if (message.aiModelName) textParts.push(message.aiModelName.toLowerCase());
                if (message.aiModelProvider) textParts.push(message.aiModelProvider.toLowerCase());
            }
        }

        // comments
        if (Array.isArray(chatLlmThread.comments) && chatLlmThread.comments.length > 0) {
            for (const comment of chatLlmThread.comments) {
                if (typeof comment?.commentText === 'string') {
                    textParts.push(comment?.commentText?.toLowerCase());
                }
            }
        }

        // ai keywords
        if (Array.isArray(chatLlmThread.aiContextKeywords) && chatLlmThread.aiContextKeywords.length > 0) {
            for (const keyword of chatLlmThread.aiContextKeywords) {
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
        if (Array.isArray(chatLlmThread.aiContextFaq) && chatLlmThread.aiContextFaq.length > 0) {
            for (const faq of chatLlmThread.aiContextFaq) {
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
            entityId: chatLlmThread._id,
        });

        // insert new record
        await ModelGlobalSearch.create({
            entityId: chatLlmThread._id,
            username: chatLlmThread.username,
            text: searchableText,
            collectionName: 'chatLlmThread',
            updatedAtUtc: chatLlmThread.updatedAtUtc || new Date(),

            rawData: {
                chatLlmThread,
            }
        });

        return null;
    } catch (error) {
        console.error('Error getting insert object from chat llm thread:', error);
        return null;
    }
};