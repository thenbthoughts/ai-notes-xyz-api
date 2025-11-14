import { Router, Request, Response } from 'express';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelNotes } from '../../schema/schemaNotes/SchemaNotes.schema';
import { llmPendingTaskTypes } from '../../utils/llmPendingTask/llmPendingTaskConstants';
import { ModelLlmPendingTaskCron } from '../../schema/schemaFunctionality/SchemaLlmPendingTaskCron.schema';
import { INotes } from '../../types/typesSchema/typesSchemaNotes/SchemaNotes.types';
import { ModelTask } from '../../schema/schemaTask/SchemaTask.schema';
import { tsTaskList } from '../../types/typesSchema/typesSchemaTask/SchemaTaskList2.types';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import { ILifeEvents } from '../../types/typesSchema/typesLifeEvents/SchemaLifeEvents.types';
import { ModelLifeEvents } from '../../schema/schemaLifeEvents/SchemaLifeEvents.schema';

const router = Router();

// Trigger LLM AI Task API
router.post('/aiRevalidateNotesTask', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let auth_username = res.locals.auth_username;

        // by user api
        let userApi = await ModelUserApiKey.findOne({
            username: auth_username,
            $or: [
                {
                    apiKeyGroqValid: true,
                },
                {
                    apiKeyOpenrouterValid: true,
                },
            ],
        });

        if (!userApi) {
            return res.status(400).json({
                status: '',
                error: 'User API key not found',
            });
        }



        // find all notes that have aiSummary or aiTags is null
        const notes = await ModelNotes.find({
            username: res.locals.auth_username,
        }) as INotes[];

        for (let index = 0; index < notes.length; index++) {
            const element = notes[index];
            // generate ai tags by id
            await ModelLlmPendingTaskCron.create({
                username: res.locals.auth_username,
                taskType: llmPendingTaskTypes.page.notes.generateNoteAiTagsById,
                targetRecordId: element._id,
            });

            // generate ai summary by id
            await ModelLlmPendingTaskCron.create({
                username: res.locals.auth_username,
                taskType: llmPendingTaskTypes.page.notes.generateNoteAiSummaryById,
                targetRecordId: element._id,
            });

            // generate embedding by id
            if (userApi?.apiKeyOllamaValid && userApi?.apiKeyQdrantValid) {
                await ModelLlmPendingTaskCron.create({
                    username: res.locals.auth_username,
                    taskType: llmPendingTaskTypes.page.notes.generateEmbeddingByNotesId,
                    targetRecordId: element._id,
                });
            }
        }

        // find all task that have aiSummary or aiTags is null
        const tasks = await ModelTask.find({
            username: res.locals.auth_username,
        }) as tsTaskList[];

        for (let index = 0; index < tasks.length; index++) {
            const element = tasks[index];

            // generate embedding by id
            if (userApi?.apiKeyOllamaValid && userApi?.apiKeyQdrantValid) {
                await ModelLlmPendingTaskCron.create({
                    username: res.locals.auth_username,
                    taskType: llmPendingTaskTypes.page.task.generateEmbeddingByTaskId,
                    targetRecordId: element._id,
                });
            }
        }

        return res.json({
            message: 'LLM AI tasks triggered successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Trigger LLM AI Generate Keywords by Source ID
router.post('/aiGenerateKeywordsBySourceId', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        let auth_username = res.locals.auth_username;

        // by user api
        let userApi = await ModelUserApiKey.findOne({
            username: auth_username,
            $or: [
                {
                    apiKeyGroqValid: true,
                },
            ],
        });

        if (!userApi) {
            return res.status(400).json({
                status: '',
                error: 'User API key not found',
            });
        }

        // find all notes that have aiSummary or aiTags is null
        const notes = await ModelNotes.find({
            username: res.locals.auth_username,
        }) as INotes[];

        const notesOperations = notes.map(element => ({
            insertOne: {
                document: {
                    username: res.locals.auth_username,
                    taskType: llmPendingTaskTypes.page.llmContext.generateKeywordsBySourceId,
                    targetRecordId: element._id,
                }
            }
        }));

        // find all tasks that have aiSummary or aiTags is null
        const tasks = await ModelTask.find({
            username: res.locals.auth_username,
        }) as tsTaskList[];

        const tasksOperations = tasks.map(element => ({
            insertOne: {
                document: {
                    username: res.locals.auth_username,
                    taskType: llmPendingTaskTypes.page.llmContext.generateKeywordsBySourceId,
                    targetRecordId: element._id,
                }
            }
        }));

        // find all life events
        const lifeEvents = await ModelLifeEvents.find({
            username: res.locals.auth_username,
        }) as ILifeEvents[];

        const lifeEventsOperations = lifeEvents.map(element => ({
            insertOne: {
                document: {
                    username: res.locals.auth_username,
                    taskType: llmPendingTaskTypes.page.llmContext.generateKeywordsBySourceId,
                    targetRecordId: element._id,
                }
            }
        }));

        // Combine all operations and execute bulk write
        const allOperations = [...notesOperations, ...tasksOperations, ...lifeEventsOperations];
        if (allOperations.length > 0) {
            await ModelLlmPendingTaskCron.bulkWrite(allOperations);
        }

        return res.json({
            message: 'LLM AI keywords generation tasks triggered successfully',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
});

export default router;