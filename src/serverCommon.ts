import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import morgan from 'morgan';
import cors from 'cors';
import cookieParser from 'cookie-parser'; // Import cookie-parser

import routesAll from './routes/routesAll';
import envKeys from './config/envKeys';
import initCron from './srcCron/indexCron';

const app = express();
app.use(express.json({
    limit: '10mb',
}));
app.use(cookieParser());

app.use(cors({
    origin: [
        'http://localhost:3000',
        'localhost:3000',
        envKeys.FRONTEND_CLIENT_URL,
        `https://${envKeys.FRONTEND_CLIENT_URL}`,
        envKeys.API_URL,
        `https://${envKeys.API_URL}`,
    ],
    methods: 'GET,POST,PUT,DELETE',
    allowedHeaders: ['Content-Type', 'Set-Cookie'],
    credentials: true,
}));

app.use((req, res, next) => {
  // Remove legacy header if present
  res.removeHeader('Feature-Policy');

  // Allow permissions for self and Capacitor WebView origin
  const cap = '"capacitor://localhost"';
  const dev = '"http://localhost"'; // optional for local testing

  res.setHeader(
    'Permissions-Policy',
    [
      `geolocation=(self ${cap} ${dev})`,
      `microphone=(self ${cap} ${dev})`,
      `camera=(self ${cap} ${dev})`,
      `autoplay=(self ${cap} ${dev})`,
      `fullscreen=(self ${cap} ${dev})`,
      `clipboard-read=(self ${cap} ${dev})`,
      `clipboard-write=(self ${cap} ${dev})`,
      `accelerometer=(self ${cap} ${dev})`,
      `gyroscope=(self ${cap} ${dev})`,
      `magnetometer=(self ${cap} ${dev})`,
      `payment=(self ${cap} ${dev})`,
      `xr-spatial-tracking=(self ${cap} ${dev})`
      // add others if your app uses them
    ].join(', ')
  );

  next();
});

// set Bearer token from cookie
app.use((req: Request, res: Response, next) => {   
    // randomDeviceId
    if (typeof req?.cookies?.randomDeviceId === 'string') {
        req.headers.authorization = `Bearer ${req.cookies.randomDeviceId}`;
    }
    next();
});

// Connect to MongoDB
mongoose
    .connect(envKeys.MONGODB_URI)
    .then(() => {
        console.log('Connected to MongoDB');
        initCron();
    })
    .catch((err) => {
        console.log('Error connecting to MongoDB', err);
        process.exit(1);
    });

// Use morgan to log requests
app.use(morgan('dev'));

app.use('/api', routesAll);
app.use('/', express.static('dist'));

// Catch-all handler to serve index.html for client-side routing
app.get('*', (req: Request, res: Response) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile('index.html', { root: 'dist' });
    }
});


export default app;