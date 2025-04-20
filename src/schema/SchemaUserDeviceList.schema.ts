import mongoose, { Document, Schema } from 'mongoose';

// UserDeviceList Interface
interface IUserDeviceList extends Document {
    username: string;
    randomDeviceId: string;
    isExpired: boolean;

    // auto
    userAgent: string;
    createdAt: Date;
    createdAtIpAddress: string;
    updatedAt: Date;
    updatedAtIpAddress: string;
}

// UserDeviceList Schema
const userDeviceListSchema = new Schema<IUserDeviceList>({
    username: { type: String, required: true, default: '' },
    randomDeviceId: { type: String, required: true, unique: true, default: '' },
    isExpired: { type: Boolean, default: false },

    // auto
    userAgent: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    createdAtIpAddress: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now },
    updatedAtIpAddress: { type: String, default: '' },
});

// UserDeviceList Model
const ModelUserDeviceList = mongoose.model<IUserDeviceList>(
    'userDeviceList',
    userDeviceListSchema,
    'userDeviceList'
);

export {
    ModelUserDeviceList
};