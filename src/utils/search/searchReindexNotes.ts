import mongoose from 'mongoose';
import { PipelineStage } from 'mongoose';
import { NodeHtmlMarkdown } from 'node-html-markdown';

import { getMongodbObjectOrNull } from '../common/getMongodbObjectOrNull';

import { IGlobalSearch } from '../../types/typesSchema/typesGlobalSearch/SchemaGlobalSearch.types';
import { ModelGlobalSearch } from '../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';

import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { INotes } from '../../types/typesSchema/typesSchemaNotes/SchemaNotes.types';
import { INotesWorkspace } from '../../types/typesSchema/typesSchemaNotes/SchemaNotesWorkspace.types';
import { ISchemaCommentCommon } from '../../types/typesSchema/typesSchemaCommentCommon/schemaCommentCommonList.types';
import { IFaq } from '../../types/typesSchema/typesFaq/SchemaFaq.types';
import { ILlmContextKeyword } from '../../types/typesSchema/typesLlmContext/SchemaLlmContextKeyword.types';

export const funcSearchReindexNotesById = async ({
    recordId,
}: {
    recordId: string;
}): Promise<IGlobalSearch | null> => {
    interface INotesAggregate extends INotes {
        _id: mongoose.Types.ObjectId;
        username: string;
        notesWorkspace: INotesWorkspace[];
        comments: ISchemaCommentCommon[];
        aiContextFaq: IFaq[];
        aiContextKeywords: ILlmContextKeyword[];
    }

    try {
        const pipelineDocument = [
            { $match: { _id: getMongodbObjectOrNull(recordId) } },
            {
                $lookup: {
                    from: 'notesWorkspace',
                    localField: 'notesWorkspaceId',
                    foreignField: '_id',
                    as: 'notesWorkspace',
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

        const noteAggArr = await ModelNotes.aggregate(pipelineDocument) as INotesAggregate[];
        const note = noteAggArr[0];

        if (!note) {
            return null;
        }

        const textParts: string[] = [];
        if (note.title) textParts.push(note.title.toLowerCase());
        if (note.description) {
            const markdownContent = NodeHtmlMarkdown.translate(note.description);
            textParts.push(markdownContent.toLowerCase());
        };
        if (note.isStar) {
            if (typeof note.isStar === 'boolean') {
                textParts.push('star');
                textParts.push('important');
            }
        }
        if (Array.isArray(note.tags)) {
            textParts.push(...note.tags.map((tag: string) => tag.toLowerCase()));
        }

        if (note.aiSummary) textParts.push(note.aiSummary.toLowerCase());
        if (Array.isArray(note.aiTags)) {
            textParts.push(...note.aiTags.map((tag: string) => tag.toLowerCase()));
        }
        if (note.aiSuggestions) textParts.push(note.aiSuggestions.toLowerCase());

        // notes workspace
        if (Array.isArray(note.notesWorkspace) && note.notesWorkspace.length > 0) {
            let notesWorkspaceObj = note.notesWorkspace[0];
            if (notesWorkspaceObj) {
                if (typeof notesWorkspaceObj?.title === 'string') {
                    textParts.push(notesWorkspaceObj?.title?.toLowerCase());
                }
            }
        }

        // comments
        if (Array.isArray(note.comments) && note.comments.length > 0) {
            for (const comment of note.comments) {
                if (typeof comment?.commentText === 'string') {
                    textParts.push(comment?.commentText?.toLowerCase());
                }
            }
        }

        // ai keywords
        if (Array.isArray(note.aiContextKeywords) && note.aiContextKeywords.length > 0) {
            for (const keyword of note.aiContextKeywords) {
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
        if (Array.isArray(note.aiContextFaq) && note.aiContextFaq.length > 0) {
            for (const faq of note.aiContextFaq) {
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
            entityId: note._id,
        });

        // insert new record
        await ModelGlobalSearch.create({
            entityId: note._id,
            username: note.username,
            text: searchableText,
            collectionName: 'notes',
            notesWorkspaceId: note.notesWorkspaceId,
            updatedAtUtc: note.updatedAtUtc || new Date(),

            rawData: {
                note,
            }
        });

        return null;
    } catch (error) {
        console.error('Error getting insert object from note new:', error);
        return null;
    }
};