import { Router, Request, Response } from 'express';

import { ModelUser } from '../../schema/schemaUser/SchemaUser.schema';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';

import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import IUser from '../../types/typesSchema/typesUser/SchemaUser.types';
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
            const auth_userId = res.locals.auth_userId;
            // const apiKeys = getApiKeyByObject(res.locals.apiKey);

            const resultApiKey = {
                userId: res.locals.auth_userId,
                clientFrontendUrl: '',
                apiKeyGroqValid: false,
                apiKeyOpenrouterValid: false,
                fileStorageType: 'gridfs',
                apiKeyS3Valid: false,
                apiKeyOllamaValid: false,
                apiKeyQdrantValid: false,
                apiKeyReplicateValid: false,
                apiKeyRunpodValid: false,
                apiKeyOpenaiValid: false,
                apiKeyLocalaiValid: false,
                smtpValid: false,
                telegramValid: false,
                agentWorkspaceValid: false,
                mcpBearerTokenValid: false,

                // timezone
                timeZoneRegion: 'Asia/Kolkata',
                timeZoneUtcOffset: 330,
            };

            const resultUserInfo = await ModelUser.findById(auth_userId)

            const resultUserInfoApi = await ModelUserApiKey.findOne(
                {
                    userId: auth_userId,
                }
            );

            // if not exist then insert
            if (!resultUserInfoApi) {
                await ModelUserApiKey.findOneAndUpdate(
                    {
                        userId: auth_userId,
                    },
                    {
                        $set: {
                            clientFrontendUrl: '',
                            apiKeyGroqValid: false,
                            apiKeyOpenrouterValid: false,
                            apiKeyS3Valid: false,
                            apiKeyOllamaValid: false,
                            apiKeyQdrantValid: false,
                            apiKeyReplicateValid: false,
                            apiKeyRunpodValid: false,
                            apiKeyOpenaiValid: false,
                            apiKeyLocalaiValid: false,
                            smtpValid: false,
                            telegramValid: false,
                            agentWorkspaceValid: false,
                            mcpBearerTokenValid: false,
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

            // api key replicate
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.apiKeyReplicateValid === 'boolean') {
                    resultApiKey.apiKeyReplicateValid = resultUserInfoApi.apiKeyReplicateValid;
                }
            }

            // api key runpod
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.apiKeyRunpodValid === 'boolean') {
                    resultApiKey.apiKeyRunpodValid = resultUserInfoApi.apiKeyRunpodValid;
                }
            }

            // api key openai
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.apiKeyOpenaiValid === 'boolean') {
                    resultApiKey.apiKeyOpenaiValid = resultUserInfoApi.apiKeyOpenaiValid;
                }
            }

            // api key localai
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.apiKeyLocalaiValid === 'boolean') {
                    resultApiKey.apiKeyLocalaiValid = resultUserInfoApi.apiKeyLocalaiValid;
                }
            }

            // smtp
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.smtpValid === 'boolean') {
                    resultApiKey.smtpValid = resultUserInfoApi.smtpValid;
                }
            }

            // telegram
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.telegramValid === 'boolean') {
                    resultApiKey.telegramValid = resultUserInfoApi.telegramValid;
                }
            }

            // ai-notes-xyz-agent-workspace
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.agentWorkspaceValid === 'boolean') {
                    resultApiKey.agentWorkspaceValid = resultUserInfoApi.agentWorkspaceValid;
                }
            }

            // per-user MCP bearer token (do not return the secret)
            if (resultUserInfoApi) {
                resultApiKey.mcpBearerTokenValid = Boolean(
                    resultUserInfoApi.mcpBearerTokenValid && resultUserInfoApi.mcpBearerToken
                );
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

            // file storage type
            if (resultUserInfoApi) {
                if (typeof resultUserInfoApi?.fileStorageType === 'string') {
                    resultApiKey.fileStorageType = resultUserInfoApi.fileStorageType;
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
            const user = await ModelUser.findById(res.locals.auth_userId).select(
                '-password'
            );
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            // Expose the canonical userId (the _id reference) alongside the doc for clients
            const userObj: any = user.toObject ? user.toObject() : { ...user };
            userObj.userId = user._id;
            return res.json(userObj);
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
            const { userId, ...updateData } = req.body;

            let updateObj = {} as Partial<IUser>;
            if (typeof updateData.name === 'string') {
                updateObj.name = updateData.name;
            }
            if (typeof updateData.email === 'string') {
                updateObj.email = updateData.email;
            }
            if (typeof updateData.dateOfBirth === 'string') {
                updateObj.dateOfBirth = updateData.dateOfBirth;
            }
            if (typeof updateData.profilePictureLink === 'string') {
                updateObj.profilePictureLink = updateData.profilePictureLink;
            }
            if (typeof updateData.bio === 'string') {
                updateObj.bio = updateData.bio;
            }
            if (Array.isArray(updateData.languages)) {
                let tempLanguages = [] as string[];
                for (const language of updateData.languages) {
                    if (typeof language === 'string') {
                        tempLanguages.push(language);
                    }
                }
                if (tempLanguages.length >= 1) {
                    updateObj.languages = tempLanguages;
                }
            }
            if (typeof updateData.city === 'string') {
                updateObj.city = updateData.city;
            }
            if (typeof updateData.state === 'string') {
                updateObj.state = updateData.state;
            }
            if (typeof updateData.country === 'string') {
                updateObj.country = updateData.country;
            }
            if (typeof updateData.zipCode === 'string') {
                updateObj.zipCode = updateData.zipCode;
            }

            // AI Features Settings
            if (typeof updateData.featureAiActionsEnabled === 'boolean') {
                updateObj.featureAiActionsEnabled = updateData.featureAiActionsEnabled;
            }
            if (typeof updateData.featureAiActionsModelProvider === 'string') {
                const validProviders = ['groq', 'openrouter', 'ollama', 'openai-compatible'];
                if (validProviders.includes(updateData.featureAiActionsModelProvider)) {
                    updateObj.featureAiActionsModelProvider = updateData.featureAiActionsModelProvider;
                }
            }
            if (typeof updateData.featureAiActionsModelName === 'string') {
                updateObj.featureAiActionsModelName = updateData.featureAiActionsModelName;
            }
            if (typeof updateData.featureAiActionsChatThread === 'boolean') {
                updateObj.featureAiActionsChatThread = updateData.featureAiActionsChatThread;
            }
            if (typeof updateData.featureAiActionsChatMessage === 'boolean') {
                updateObj.featureAiActionsChatMessage = updateData.featureAiActionsChatMessage;
            }
            if (typeof updateData.featureAiActionsNotes === 'boolean') {
                updateObj.featureAiActionsNotes = updateData.featureAiActionsNotes;
            }
            if (typeof updateData.featureAiActionsTask === 'boolean') {
                updateObj.featureAiActionsTask = updateData.featureAiActionsTask;
            }
            if (typeof updateData.featureAiActionsLifeEvents === 'boolean') {
                updateObj.featureAiActionsLifeEvents = updateData.featureAiActionsLifeEvents;
            }
            if (typeof updateData.featureAiActionsInfoVault === 'boolean') {
                updateObj.featureAiActionsInfoVault = updateData.featureAiActionsInfoVault;
            }

            // Memory Settings
            if (typeof updateData.isStoreUserMemoriesEnabled === 'boolean') {
                updateObj.isStoreUserMemoriesEnabled = updateData.isStoreUserMemoriesEnabled;
            }
            if (typeof updateData.userMemoriesLimit === 'number') {
                if (updateData.userMemoriesLimit >= 0 && updateData.userMemoriesLimit <= 100) {
                    updateObj.userMemoriesLimit = updateData.userMemoriesLimit;
                }
            }

            if (Object.keys(updateObj).length === 0) {
                return res.status(400).json({ message: 'No valid fields provided for update' });
            }

            const updatedUser = await ModelUser.findByIdAndUpdate(
                res.locals.auth_userId,
                { $set: updateObj },
                {
                    new: true
                }
            );
            if (!updatedUser) {
                return res.status(404).json({ message: 'User not found' });
            }
            const updatedObj: any = updatedUser.toObject ? updatedUser.toObject() : { ...updatedUser };
            updatedObj.userId = updatedUser._id;
            return res.json(updatedObj);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error' });
        }
    }
);

export default router;