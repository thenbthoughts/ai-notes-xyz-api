import mongoose, { Document } from 'mongoose';

export type OpencodeTaskStatus = 'pending' | 'running' | 'done' | 'error';

export interface OpencodeTaskFileRef {
    fileName: string;
    filePath: string;
    contentType: string;
    size: number;
}

export interface IChatLlmOpencodeTask extends Document {
    _id: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;

    triggerMessageId?: mongoose.Types.ObjectId | null;
    answerMachineRecordId?: mongoose.Types.ObjectId | null;

    sortIndex: number;
    title: string;
    instruction: string;

    status: OpencodeTaskStatus;
    summary: string;
    errorReason: string;
    /** Text snapshot of OpenCode session messages produced for this task (user + assistant/tool parts). */
    agentTranscript: string;

    inputFileRefs: OpencodeTaskFileRef[];
    outputFileRefs: OpencodeTaskFileRef[];

    /** When status became `running` (OpenCode execution window). */
    runStartedAtUtc?: Date | null;
    /** When status became `done` or `error`. */
    runFinishedAtUtc?: Date | null;

    createdAtUtc: Date;
    updatedAtUtc: Date;
}

