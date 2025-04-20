import mongoose, { Schema } from 'mongoose';

import { tsTaskBoard } from '../types/typesSchema/SchemaTaskBoard.types';

// TodoBoard Schema
const taskBoardSchema = new Schema<tsTaskBoard>({
    // identification
    boardName: {
        type: String,
        required: true,
        trim: true,
    },
    username: {
        type: String,
        required: true,
        default: '',
        index: true,
    },
});

// TodoBoard Model
const ModelTaskBoard = mongoose.model<tsTaskBoard>(
    'taskBoard',
    taskBoardSchema,
    'taskBoard'
);

export {
    ModelTaskBoard
};