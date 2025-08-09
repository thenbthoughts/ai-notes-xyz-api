import mongoose, { Schema } from 'mongoose';
import { tsTaskListScheduleAddTask } from '../../types/typesSchema/typesSchemaTaskSchedule/SchemaTaskListScheduleAddTask.types';

const taskScheduleAddTaskSchema = new Schema<tsTaskListScheduleAddTask>({
    // identification
    taskScheduleId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },

    // auth
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },

    taskTitle: {
        type: String,
        default: '',
    },
    taskDatePrefix: {
        type: Boolean,
        default: false,
    },
    taskDeadline: {
        type: String,
        default: '',
    },
    taskAiSummary: {
        type: Boolean,
        default: false,
    },
    taskAiContext: {
        type: String,
        default: '',
    },

    // identification
    taskWorkspaceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    taskStatusId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
});

const ModelTaskScheduleAddTask = mongoose.model<tsTaskListScheduleAddTask>(
    'taskScheduleAddTask',
    taskScheduleAddTaskSchema,
    'taskScheduleAddTask'
);

export {
    ModelTaskScheduleAddTask
};