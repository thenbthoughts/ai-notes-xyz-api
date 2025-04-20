import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import morgan from 'morgan';
import cors from 'cors';
import cookieParser from 'cookie-parser'; // Import cookie-parser

import routesAll from './routes/routesAll';
import envKeys from './config/envKeys';

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use(cors({
    origin: [
        'http://localhost:3000',
        'localhost:3000',
        envKeys.FRONTEND_CLIENT_URL,
        `https://${envKeys.FRONTEND_CLIENT_URL}`
    ],
    methods: 'GET,POST,PUT,DELETE',
    allowedHeaders: ['Content-Type', 'Set-Cookie'],
    credentials: true,
}));

// set Bearer token from cookie
app.use((req: Request, res: Response, next) => {   
    // randomDeviceId
    if (typeof req?.cookies?.randomDeviceId === 'string') {
        req.headers.authorization = `Bearer ${req.cookies.randomDeviceId}`;
    }
    next();
});

// Connect to MongoDB
mongoose.connect(envKeys.MONGODB_URI);

// Use morgan to log requests
app.use(morgan('dev'));

app.use('/', express.static('dist'));
app.use('/api', routesAll);

export default app;