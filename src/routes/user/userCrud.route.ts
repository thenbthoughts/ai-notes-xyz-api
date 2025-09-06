import { Router, Request, Response } from 'express';

import { ModelUser } from '../../schema/schemaUser/SchemaUser.schema';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
// import { getApiKeyByObject } from '../../utils/llm/llmCommonFunc';

// Router
const router = Router();

// Refresh Token API
router.post(
    '/refresh-token',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const auth_username = res.locals.auth_username;
            // const apiKeys = getApiKeyByObject(res.locals.apiKey);

            const resultApiKey = {
                username: res.locals.auth_username,
                clientFrontendUrl: '',
                apiKeyGroqValid: false,
                apiKeyOpenrouterValid: false,
                apiKeyS3Valid: false,
                apiKeyOllamaValid: false,
                apiKeyQdrantValid: false,
                smtpValid: false,

                // timezone
                timeZoneRegion: 'Asia/Kolkata',
                timeZoneUtcOffset: 330,
            };

            const resultUserInfo = await ModelUser.findOne({
                username: auth_username,
            })

            const resultUserInfoApi = await ModelUserApiKey.findOne(
                {
                    username: auth_username,
                }
            );

            // if not exist then insert
            if (!resultUserInfoApi) {
                await ModelUserApiKey.findOneAndUpdate(
                    {
                        username: auth_username,
                    },
                    {
                        $set: {
                            clientFrontendUrl: '',
                            apiKeyGroqValid: false,
                            apiKeyOpenrouterValid: false,
                            apiKeyS3Valid: false,
                            apiKeyOllamaValid: false,
                            apiKeyQdrantValid: false,
                            smtpValid: false,
                        }
                    },
                    {
                        upsert: true,
                        setDefaultsOnInsert: true,
                    }
                );
            }

            // api key groq
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.apiKeyGroqValid === 'boolean') {
                    resultApiKey.apiKeyGroqValid = resultUserInfoApi.apiKeyGroqValid;
                }
            }

            // api key openrouter
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.apiKeyOpenrouterValid === 'boolean') {
                    resultApiKey.apiKeyOpenrouterValid = resultUserInfoApi.apiKeyOpenrouterValid;
                }
            }

            // api key s3
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.apiKeyS3Valid === 'boolean') {
                    resultApiKey.apiKeyS3Valid = resultUserInfoApi.apiKeyS3Valid;
                }
            }

            // api key ollama
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.apiKeyOllamaValid === 'boolean') {
                    resultApiKey.apiKeyOllamaValid = resultUserInfoApi.apiKeyOllamaValid;
                }
            }

            // api key qdrant
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.apiKeyQdrantValid === 'boolean') {
                    resultApiKey.apiKeyQdrantValid = resultUserInfoApi.apiKeyQdrantValid;
                }
            }

            // smtp
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.smtpValid === 'boolean') {
                    resultApiKey.smtpValid = resultUserInfoApi.smtpValid;
                }
            }

            if (resultUserInfo) {
                if (resultUserInfo.timeZoneRegion) {
                    if (typeof resultUserInfo.timeZoneRegion === 'string') {
                        if (resultUserInfo.timeZoneRegion.length >= 1) {
                            resultApiKey.timeZoneRegion = resultUserInfo.timeZoneRegion;
                        }
                    }
                    if (typeof resultUserInfo.timeZoneUtcOffset === 'number') {
                        resultApiKey.timeZoneUtcOffset = resultUserInfo.timeZoneUtcOffset;
                    }
                }
            }

            // client frontend url
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.clientFrontendUrl === 'string') {
                    resultApiKey.clientFrontendUrl = resultUserInfoApi.clientFrontendUrl;
                }
            }

            // Return user info
            return res.json({
                user: {
                    ...resultApiKey,
                }
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Get User API
router.post(
    '/getUser',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const user = await ModelUser.findOne({
                username: res.locals.auth_username
            }).select(
                '-password'
            );
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            return res.json(user);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

// Update User API
router.post(
    '/updateUser',
    middlewareUserAuth,
    async (
        req: Request, res: Response
    ) => {
        try {
            const { username, ...updateData } = req.body;
            const updatedUser = await ModelUser.findOneAndUpdate(
                {
                    username: res.locals.auth_username
                },
                {
                    name: updateData.name || '',
                    email: updateData.email || '',
                    dateOfBirth: updateData.dateOfBirth || '',
                    profilePictureLink: updateData.profilePictureLink || '',
                    bio: updateData.bio || '',
                    city: updateData.city || '',
                    state: updateData.state || '',
                    country: updateData.country || '',
                    zipCode: updateData.zipCode || '',

                    // 
                    preferredModelProvider: updateData.preferredModelProvider || '',
                    preferredModelName: updateData.preferredModelName || '',
                },
                {
                    new: true
                }
            );
            if (!updatedUser) {
                return res.status(404).json({ message: 'User not found' });
            }
            return res.json(updatedUser);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;