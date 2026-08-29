import mongoose, { Document, Schema } from 'mongoose';

// UserDeviceList Interface
interface IUserDeviceList extends Document {
    userId: mongoose.Types.ObjectId;
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
    userId: { type: Schema.Types.ObjectId, ref: 'user', required: true },
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