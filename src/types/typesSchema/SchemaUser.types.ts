import { Document } from 'mongoose';

// User Interface
interface IUser extends Document {
    username: string;
    password: string;

    // personal info
    name: string;
    dateOfBirth: string;
    profilePictureLink: string;
    bio: string;

    // location
    city: string;
    state: string;
    country: string;
    zipCode: string;

    // email
    email: string;
    emailVerified: boolean;

    // 
    phoneNumber: string;
    address: string;
    website: string;

    preferredModelProvider: string;
    preferredModelName: string;

    // timezone
    timeZoneRegion: string;
    timeZoneUtcOffset: number;
}

export default IUser;