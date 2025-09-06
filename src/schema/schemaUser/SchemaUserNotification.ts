import mongoose, { Schema } from 'mongoose';
import IUserNotification from '../../types/typesSchema/typesUser/SchemaUserNotification.types';

// User Schema
const userNotificationSchema = new Schema<IUserNotification>({
    username: { type: String, required: true, lowercase: true },

    // personal info
    smtpTo: {
        type: String,
        default: ''
    },
    subject: {
        type: String,
        default: ''
    },
    text: {
        type: String,
        default: ''
    },
    html: {
        type: String,
        default: ''
    },

    // createdAt
    createdAtUtc: {
        type: Date,
        default: Date.now
    },
});

// User Model
const ModelUserNotification = mongoose.model<IUserNotification>(
    'userNotification',
    userNotificationSchema,
    'userNotification',
);

export {
    ModelUserNotification
};