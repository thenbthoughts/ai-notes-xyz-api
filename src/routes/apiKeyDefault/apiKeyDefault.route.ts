import { Router, Request, Response } from 'express';
import middlewareUserAuth from '../../middleware/middlewareUserAuth';
import { ModelUserApiKey } from '../../schema/schemaUser/SchemaUserApiKey.schema';
import envKeys from '../../config/envKeys';
import { ModelUser } from '../../schema/schemaUser/SchemaUser.schema';

// Router
const router = Router();

// Add Note API
router.post('/updateApiKeyDefault', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        if (envKeys.DEFAULT_ENV_ENABLED !== "yes") {
            return res.status(400).json({
                success: '',
                error: 'Default env are not enabled.',
            });
        }

        const auth_username = res.locals.auth_username;

        let updateObj = {
            // apikey - groq
            apiKeyGroqValid: false,
            apiKeyGroq: '',

            // apikey - openrouter
            apiKeyOpenrouterValid: false,
            apiKeyOpenrouter: '',

            // apikey - s3
            apiKeyS3Valid: false,
            apiKeyS3Endpoint: '',
            apiKeyS3Region: '',
            apiKeyS3AccessKeyId: '',
            apiKeyS3SecretAccessKey: '',
            apiKeyS3BucketName: '',

            // apikey - ollama
            apiKeyOllamaValid: false,
            apiKeyOllamaEndpoint: '',

            // apikey - qdrant
            apiKeyQdrantValid: false,
            apiKeyQdrantEndpoint: '',
            apiKeyQdrantPassword: '',
        }

        if (envKeys.DEFAULT_ENV_GROQ_API_KEY.length >= 1) {
            updateObj.apiKeyGroqValid = true;
            updateObj.apiKeyGroq = envKeys.DEFAULT_ENV_GROQ_API_KEY;
        }

        if (envKeys.DEFAULT_ENV_OPEN_ROUTER_KEY.length >= 1) {
            updateObj.apiKeyOpenrouterValid = true;
            updateObj.apiKeyOpenrouter = envKeys.DEFAULT_ENV_OPEN_ROUTER_KEY;
        }

        if (envKeys.DEFAULT_ENV_S3_ENDPOINT.length >= 1) {
            updateObj.apiKeyS3Valid = true;
            updateObj.apiKeyS3Endpoint = envKeys.DEFAULT_ENV_S3_ENDPOINT;
            updateObj.apiKeyS3Region = envKeys.DEFAULT_ENV_S3_REGION;
            updateObj.apiKeyS3AccessKeyId = envKeys.DEFAULT_ENV_S3_ACCESS_KEY_ID;
            updateObj.apiKeyS3SecretAccessKey = envKeys.DEFAULT_ENV_S3_SECRET_ACCESS_KEY;
            updateObj.apiKeyS3BucketName = envKeys.DEFAULT_ENV_S3_BUCKET_NAME;
        }

        // Update the user's API keys in the database
        const updatedUser = await ModelUserApiKey.findOneAndUpdate(
            { username: auth_username },
            {
                $set: {
                    ...updateObj,
                }
            },
            { new: true }
        );

        if (envKeys.DEFAULT_ENV_OPEN_ROUTER_KEY.length >= 1) {
            const updatedUserModel = await ModelUser.findOneAndUpdate(
                {
                    username: auth_username,
                },
                {
                    $set: {
                        preferredModelProvider: 'openrouter',
                        preferredModelName: 'inflection/inflection-3-pi',
                    }
                }
            )
        }

        if (!updatedUser) {
            return res.status(404).json({
                success: '',
                error: 'User not found'
            });
        }

        return res.status(200).json({
            success: 'API keys updated successfully',
            error: '',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: '',
            error: 'Server error',
        });
    }
});

export default router;