import mongoose, { Schema } from 'mongoose';

import { tsTaskBoardList } from '../types/typesSchema/schemaTaskBoardList.types';

// TaskBoardList Schema
const taskBoardListSchema = new Schema<tsTaskBoardList>({
    // fields
    boardName: {
        type: String,
        required: true,
        trim: true,
        default: 'Task',
    },
    boardListName: {
        type: String,
        required: true,
        trim: true,
        default: 'Todo',
    },
    listPosition: {
        type: Number,
        required: true,
        default: 100,
    },

    // auth
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },
});

// TaskBoardList Model
const ModelTaskBoardList = mongoose.model<tsTaskBoardList>(
    'taskBoardList',
    taskBoardListSchema,
    'taskBoardList'
);

export {
    ModelTaskBoardList
};