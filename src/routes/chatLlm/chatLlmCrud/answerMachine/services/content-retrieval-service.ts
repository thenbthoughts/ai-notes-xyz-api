import mongoose from "mongoose";
import { ModelTask } from "../../../../../schema/schemaTask/SchemaTask.schema";
import { ModelNotes } from "../../../../../schema/schemaNotes/SchemaNotes.schema";
import { ModelLifeEvents } from "../../../../../schema/schemaLifeEvents/SchemaLifeEvents.schema";
import { ModelInfoVault } from "../../../../../schema/schemaInfoVault/SchemaInfoVault.schema";
import { TaskItem, NoteItem, LifeEventItem, InfoVaultItem } from "../types/answer-machine.types";

/**
 * Service for retrieving content from different data sources
 */
export class ContentRetrievalService {

    /**
     * Get content from all relevant sources based on context IDs
     */
    static async getContextContent(
        contextIds: mongoose.Types.ObjectId[],
        username: string
    ): Promise<string> {
        if (contextIds.length === 0) {
            return '';
        }

        try {
            const [
                tasksContent,
                notesContent,
                lifeEventsContent,
                infoVaultContent
            ] = await Promise.all([
                this.getTasksContent(contextIds),
                this.getNotesContent(contextIds),
                this.getLifeEventsContent(contextIds),
                this.getInfoVaultContent(contextIds),
            ]);

            // Combine all content
            const allContent = [
                tasksContent,
                notesContent,
                lifeEventsContent,
                infoVaultContent
            ].filter(content => content.trim().length > 0);

            if (allContent.length === 0) {
                return '';
            }

            return allContent.join('\n\n---\n\n');

        } catch (error) {
            console.error('[Content Retrieval] Error getting context content:', error);
            return '';
        }
    }

    /**
     * Get task content for given context IDs
     */
    private static async getTasksContent(contextIds: mongoose.Types.ObjectId[]): Promise<string> {
        try {
            const tasks = await ModelTask.find({
                _id: { $in: contextIds },
            }).select('title description status priority dueDate createdAtUtc updatedAtUtc') as TaskItem[];

            if (tasks.length === 0) {
                return '';
            }

            const taskContents = tasks.map((task: TaskItem) => {
                const content = [
                    `Task: ${task.title || 'Untitled'}`,
                    task.description ? `Description: ${task.description}` : null,
                    `Status: ${task.status || 'Unknown'}`,
                    task.priority ? `Priority: ${task.priority}` : null,
                    task.dueDate ? `Due Date: ${task.dueDate.toISOString().split('T')[0]}` : null,
                    `Created: ${task.createdAtUtc?.toISOString().split('T')[0] || 'Unknown'}`,
                    `Updated: ${task.updatedAtUtc?.toISOString().split('T')[0] || 'Unknown'}`,
                ].filter(Boolean);

                return content.join('\n');
            });

            return `TASKS:\n${taskContents.join('\n\n')}`;

        } catch (error) {
            console.error('[Content Retrieval] Error getting tasks content:', error);
            return '';
        }
    }

    /**
     * Get notes content for given context IDs
     */
    private static async getNotesContent(contextIds: mongoose.Types.ObjectId[]): Promise<string> {
        try {
            const notes = await ModelNotes.find({
                _id: { $in: contextIds },
            }).select('title content tags createdAtUtc updatedAtUtc') as NoteItem[];

            if (notes.length === 0) {
                return '';
            }

            const noteContents = notes.map((note: NoteItem) => {
                const content = [
                    `Note: ${note.title || 'Untitled'}`,
                    note.content ? `Content: ${note.content}` : null,
                    note.tags && note.tags.length > 0 ? `Tags: ${note.tags.join(', ')}` : null,
                    `Created: ${note.createdAtUtc?.toISOString().split('T')[0] || 'Unknown'}`,
                    `Updated: ${note.updatedAtUtc?.toISOString().split('T')[0] || 'Unknown'}`,
                ].filter(Boolean);

                return content.join('\n');
            });

            return `NOTES:\n${noteContents.join('\n\n')}`;

        } catch (error) {
            console.error('[Content Retrieval] Error getting notes content:', error);
            return '';
        }
    }

    /**
     * Get life events content for given context IDs
     */
    private static async getLifeEventsContent(contextIds: mongoose.Types.ObjectId[]): Promise<string> {
        try {
            const lifeEvents = await ModelLifeEvents.find({
                _id: { $in: contextIds },
            }).select('title description eventDateUtc categoryId tags createdAtUtc updatedAtUtc') as LifeEventItem[];

            if (lifeEvents.length === 0) {
                return '';
            }

            const eventContents = lifeEvents.map((event: LifeEventItem) => {
                const content = [
                    `Life Event: ${event.title || 'Untitled'}`,
                    event.description ? `Description: ${event.description}` : null,
                    event.eventDateUtc ? `Date: ${event.eventDateUtc.toISOString().split('T')[0]}` : null,
                    event.categoryId ? `Category: ${event.categoryId}` : null,
                    event.tags && event.tags.length > 0 ? `Tags: ${event.tags.join(', ')}` : null,
                    `Created: ${event.createdAtUtc?.toISOString().split('T')[0] || 'Unknown'}`,
                    `Updated: ${event.updatedAtUtc?.toISOString().split('T')[0] || 'Unknown'}`,
                ].filter(Boolean);

                return content.join('\n');
            });

            return `LIFE EVENTS:\n${eventContents.join('\n\n')}`;

        } catch (error) {
            console.error('[Content Retrieval] Error getting life events content:', error);
            return '';
        }
    }

    /**
     * Get info vault content for given context IDs
     */
    private static async getInfoVaultContent(contextIds: mongoose.Types.ObjectId[]): Promise<string> {
        try {
            const infoItems = await ModelInfoVault.find({
                _id: { $in: contextIds },
            }).select('title name content category tags createdAtUtc updatedAtUtc') as InfoVaultItem[];

            if (infoItems.length === 0) {
                return '';
            }

            const itemContents = infoItems.map((item: InfoVaultItem) => {
                const content = [
                    `Info Item: ${item.title || item.name || 'Untitled'}`,
                    item.content ? `Content: ${item.content}` : null,
                    item.category ? `Category: ${item.category}` : null,
                    item.tags && item.tags.length > 0 ? `Tags: ${item.tags.join(', ')}` : null,
                    `Created: ${item.createdAtUtc?.toISOString().split('T')[0] || 'Unknown'}`,
                    `Updated: ${item.updatedAtUtc?.toISOString().split('T')[0] || 'Unknown'}`,
                ].filter(Boolean);

                return content.join('\n');
            });

            return `INFO VAULT:\n${itemContents.join('\n\n')}`;

        } catch (error) {
            console.error('[Content Retrieval] Error getting info vault content:', error);
            return '';
        }
    }
}