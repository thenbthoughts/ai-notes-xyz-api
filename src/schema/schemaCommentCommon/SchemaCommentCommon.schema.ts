import mongoose, { Schema } from 'mongoose';
import { ISchemaCommentCommon } from '../../types/typesSchema/typesSchemaCommentCommon/schemaCommentCommonList.types';

// commentsCommonSchema
const commentsCommonSchema = new Schema<ISchemaCommentCommon>({
    // Comment specific fields
    commentText: {
        type: String,
        default: '',
        trim: true,
    },
    isAi: {
        type: Boolean,
        default: false,
    },

    // file fields
    fileType: {
        type: String,
        default: '',
        // fileType "image", "video", "audio" or "file"
    },
    fileUrl: { type: String, default: '' },
    fileTitle: { type: String, default: '' },
    fileDescription: { type: String, default: '' },

    // ai
    aiTitle: { type: String, default: '' },
    aiSummaryContext: { type: String, default: '' },
    aiSummarySpecific: { type: String, default: '' },
    aiTags: { type: [String], default: [] },

    // auth
    username: {
        type: String,
        default: '',
        index: true,
    },

    // Reference to the notes, task, lifeEvent, infoVault
    commentType: { type: String, default: '' }, // note | task | lifeEvent | infoVault
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },

    // auto
    createdAtUtc: {
        type: Date,
        default: null,
    },
    createdAtIpAddress: {
        type: String,
        default: '',
    },
    createdAtUserAgent: {
        type: String,
        default: '',
    },
    updatedAtUtc: {
        type: Date,
        default: null,
    },
    updatedAtIpAddress: {
        type: String,
        default: '',
    },
    updatedAtUserAgent: {
        type: String,
        default: '',
    },
});

// Comment Model
const ModelCommentCommon = mongoose.model<ISchemaCommentCommon>(
    'commentsCommon',
    commentsCommonSchema,
    'commentsCommon'
);

export {
    ModelCommentCommon,
};