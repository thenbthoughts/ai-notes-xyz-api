import { Document } from 'mongoose';

// Chat Interface
export interface IChatOne extends Document {
    // identification - pagination
    dateTimeUtc: Date | null;
    paginationDateLocalYearMonthStr: string;
    paginationDateLocalYearMonthDateStr: string;

    type: string,
    content: string;
    username: string;
    tags: string[];
    visibility: string;
    fileUrlArr: string[];

    // model info
    isAi: boolean;
    aiModelName: string;
    aiModelProvider: string;

    // file
    fileUrl: string;
    fileContentAi: string;

    // auto
    createdAtUtc: Date;
    createdAtIpAddress: string;
    createdAtUserAgent: string;
    updatedAtUtc: Date;
    updatedAtIpAddress: string;
    updatedAtUserAgent: string;

    // auto ai
    tagsAutoAi: string[];
};