import mongoose from 'mongoose';
import { PipelineStage } from 'mongoose';
import { NodeHtmlMarkdown } from 'node-html-markdown';

import { getMongodbObjectOrNull } from '../common/getMongodbObjectOrNull';

import { IGlobalSearch } from '../../types/typesSchema/typesGlobalSearch/SchemaGlobalSearch.types';
import { ModelGlobalSearch } from '../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';

import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { tsTaskList } from '../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types';
import { ITaskWorkspace } from '../../types/typesSchema/typesSchemaTask/SchemaTaskWorkspace.types';
import { tsTaskStatusList } from '../../types/typesSchema/typesSchemaTask/SchemaTaskStatusList.types';
import { tsTaskSubList } from '../../types/typesSchema/typesSchemaTask/schemaTaskSubList.types';
import { ISchemaCommentCommon } from '../../types/typesSchema/typesSchemaCommentCommon/schemaCommentCommonList.types';
import { IFaq } from '../../types/typesSchema/typesFaq/SchemaFaq.types';
import { ILlmContextKeyword } from '../../types/typesSchema/typesLlmContext/SchemaLlmContextKeyword.types';

export const funcSearchReindexTasksById = async ({
    recordId,
}: {
    recordId: string;
}): Promise<IGlobalSearch | null> => {
    interface ITaskAggregate {
        _id: mongoose.Types.ObjectId;
        username: string;
        title: string;
        description: string;
        priority: string;
        dueDate: Date | null;
        labels: string[];
        labelsAi: string[];
        reminderPresetTimeLabel: string;
        isTaskPinned: boolean;
        taskWorkspaceId: mongoose.Types.ObjectId | null;
        taskStatusId: mongoose.Types.ObjectId | null;
        isArchived: boolean;
        isCompleted: boolean;
        updatedAtUtc: Date | null;
        taskWorkspace: ITaskWorkspace[];
        taskStatus: tsTaskStatusList[];
        subtasks: tsTaskSubList[];
        comments: ISchemaCommentCommon[];
        aiContextFaq: IFaq[];
        aiContextKeywords: ILlmContextKeyword[];
    }

    try {
        const pipelineDocument = [
            { $match: { _id: getMongodbObjectOrNull(recordId) } },
            {
                $lookup: {
                    from: 'taskWorkspace',
                    localField: 'taskWorkspaceId',
                    foreignField: '_id',
                    as: 'taskWorkspace',
                }
            },
            {
                $lookup: {
                    from: 'taskStatusList',
                    localField: 'taskStatusId',
                    foreignField: '_id',
                    as: 'taskStatus',
                }
            },
            {
                $lookup: {
                    from: 'tasksSub',
                    localField: '_id',
                    foreignField: 'parentTaskId',
                    as: 'subtasks',
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

        const taskAggArr = await ModelTask.aggregate(pipelineDocument) as ITaskAggregate[];
        const task = taskAggArr[0];

        if (!task) {
            return null;
        }

        const textParts: string[] = [];
        if (task.title) textParts.push(task.title.toLowerCase());
        if (task.description) {
            const markdownContent = NodeHtmlMarkdown.translate(task.description);
            textParts.push(markdownContent.toLowerCase());
        }
        if (task.priority) textParts.push(task.priority.toLowerCase());
        if (task.dueDate) {
            // Add due date information
            const dueDateStr = task.dueDate.toISOString().split('T')[0]; // YYYY-MM-DD format
            textParts.push(dueDateStr);
            // Also add readable date components
            const date = new Date(task.dueDate);
            textParts.push(date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
        }
        if (Array.isArray(task.labels)) {
            textParts.push(...task.labels.map((label: string) => label.toLowerCase()));
        }
        if (Array.isArray(task.labelsAi)) {
            textParts.push(...task.labelsAi.map((label: string) => label.toLowerCase()));
        }
        if (task.reminderPresetTimeLabel) {
            textParts.push(task.reminderPresetTimeLabel.toLowerCase());
        }
        if (task.isTaskPinned) {
            textParts.push('pinned');
            textParts.push('important');
        }

        // task workspace
        if (Array.isArray(task.taskWorkspace) && task.taskWorkspace.length > 0) {
            let taskWorkspaceObj = task.taskWorkspace[0];
            if (taskWorkspaceObj) {
                if (typeof taskWorkspaceObj?.title === 'string') {
                    textParts.push(taskWorkspaceObj?.title?.toLowerCase());
                }
            }
        }

        // task status
        if (Array.isArray(task.taskStatus) && task.taskStatus.length > 0) {
            let taskStatusObj = task.taskStatus[0];
            if (taskStatusObj) {
                if (typeof taskStatusObj?.statusTitle === 'string') {
                    textParts.push(taskStatusObj?.statusTitle?.toLowerCase());
                }
            }
        }

        // subtasks
        if (Array.isArray(task.subtasks) && task.subtasks.length > 0) {
            for (const subtask of task.subtasks) {
                if (subtask.title) textParts.push(subtask.title.toLowerCase());
                if (subtask.taskCompletedStatus === false) {
                    textParts.push('pending');
                    textParts.push('incomplete');
                }
                if (subtask.taskCompletedStatus === true) {
                    textParts.push('completed');
                    textParts.push('done');
                }
            }
        }

        // comments
        if (Array.isArray(task.comments) && task.comments.length > 0) {
            for (const comment of task.comments) {
                if (typeof comment?.commentText === 'string') {
                    textParts.push(comment?.commentText?.toLowerCase());
                }
            }
        }

        // ai keywords
        if (Array.isArray(task.aiContextKeywords) && task.aiContextKeywords.length > 0) {
            for (const keyword of task.aiContextKeywords) {
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
        if (Array.isArray(task.aiContextFaq) && task.aiContextFaq.length > 0) {
            for (const faq of task.aiContextFaq) {
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
            entityId: task._id,
        });

        // insert new record
        await ModelGlobalSearch.create({
            entityId: task._id,
            username: task.username,
            text: searchableText,
            collectionName: 'tasks',
            taskWorkspaceId: task.taskWorkspaceId,
            taskIsCompleted: task.isCompleted,
            taskIsArchived: task.isArchived,
            updatedAtUtc: task.updatedAtUtc || new Date(),

            rawData: {
                task,
            }
        });

        return null;
    } catch (error) {
        console.error('Error getting insert object from task:', error);
        return null;
    }
};