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
        let auth_userId = res.locals.auth_userId;

        // by user api
        let userApi = await ModelUserApiKey.findOne({
            userId: auth_userId,
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
            userId: res.locals.auth_userId,
        }) as INotes[];

        for (let index = 0; index < notes.length; index++) {
            const element = notes[index];

            // generate ai summary by id
            await ModelLlmPendingTaskCron.create({
                userId: res.locals.auth_userId,
                taskType: llmPendingTaskTypes.page.featureAiActions.notes,
                targetRecordId: element._id,
            });
        }

        // find all task that have aiSummary or aiTags is null
        const tasks = await ModelTask.find({
            userId: res.locals.auth_userId,
        }) as tsTaskList[];

        for (let index = 0; index < tasks.length; index++) {
            const element = tasks[index];

            // generate Feature AI Actions by source id (includes FAQ, Summary, Tags, Embedding)
            if (userApi?.apiKeyOllamaValid && userApi?.apiKeyQdrantValid) {
                await ModelLlmPendingTaskCron.create({
                    userId: res.locals.auth_userId,
                    taskType: llmPendingTaskTypes.page.featureAiActions.task,
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
        let auth_userId = res.locals.auth_userId;

        // by user api
        let userApi = await ModelUserApiKey.findOne({
            userId: auth_userId,
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
            userId: res.locals.auth_userId,
        }) as INotes[];

        const notesOperations = notes.map(element => ({
            insertOne: {
                document: {
                    userId: res.locals.auth_userId,
                    taskType: llmPendingTaskTypes.page.featureAiActions.notes,
                    targetRecordId: element._id,
                }
            }
        }));

        // find all tasks that have aiSummary or aiTags is null
        const tasks = await ModelTask.find({
            userId: res.locals.auth_userId,
        }) as tsTaskList[];

        const tasksOperations = tasks.map(element => ({
            insertOne: {
                document: {
                    userId: res.locals.auth_userId,
                    taskType: llmPendingTaskTypes.page.featureAiActions.task,
                    targetRecordId: element._id,
                }
            }
        }));

        // find all life events
        const lifeEvents = await ModelLifeEvents.find({
            userId: res.locals.auth_userId,
        }) as ILifeEvents[];

        const lifeEventsOperations = lifeEvents.map(element => ({
            insertOne: {
                document: {
                    userId: res.locals.auth_userId,
                    taskType: llmPendingTaskTypes.page.featureAiActions.lifeEvents,
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