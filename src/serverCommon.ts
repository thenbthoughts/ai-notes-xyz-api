import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import morgan from 'morgan';
import cors from 'cors';
import cookieParser from 'cookie-parser'; // Import cookie-parser

import routesAll from './routes/routesAll';
import envKeys from './config/envKeys';
import initCron from './srcCron/indexCron';
import migrateUsernameToUserId from './migrations/migrateUsernameToUserId';

const app = express();
app.use(express.json({
    limit: '16mb',
}));
app.use(cookieParser());

const CAPACITOR_WEBVIEW_ORIGINS = [
    'capacitor://localhost',
    'http://localhost',
    'https://localhost',
    'ionic://localhost',
];

app.use(cors({
    origin: (origin, callback) => {
        const allowed = new Set([
            'http://localhost:3000',
            'localhost:3000',
            envKeys.FRONTEND_CLIENT_URL,
            `https://${envKeys.FRONTEND_CLIENT_URL}`,
            envKeys.API_URL,
            `https://${envKeys.API_URL}`,
            ...CAPACITOR_WEBVIEW_ORIGINS,
        ]);
        if (!origin || allowed.has(origin)) {
            callback(null, true);
            return;
        }
        callback(null, false);
    },
    methods: 'GET,POST,PUT,DELETE,PATCH',
    allowedHeaders: [
        'Content-Type',
        'Set-Cookie',
        'Authorization',
        'Range',
        'X-MCP-Bearer',
        'X-Chat-Message-Id',
        'Mcp-Session-Id',
        'MCP-Protocol-Version',
    ],
    exposedHeaders: ['Accept-Ranges', 'Content-Range', 'Content-Length', 'Content-Type'],
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
    if (req.path.startsWith('/api/mcp')) {
        next();
        return;
    }
    // randomDeviceId
    if (typeof req?.cookies?.randomDeviceId === 'string') {
        req.headers.authorization = `Bearer ${req.cookies.randomDeviceId}`;
    }
    next();
});

// Connect to MongoDB
mongoose
    .connect(envKeys.MONGODB_URI)
    .then(async () => {
        console.log('Connected to MongoDB');
        try {
            await migrateUsernameToUserId();
        } catch (migrationError) {
            console.error('Username-to-userId migration failed:', migrationError);
        }
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