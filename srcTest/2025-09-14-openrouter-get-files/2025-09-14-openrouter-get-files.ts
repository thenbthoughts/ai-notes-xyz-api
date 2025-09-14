import axios from "axios";
import { ModelUserApiKey } from "../../src/schema/schemaUser/SchemaUserApiKey.schema";
import mongoose from "mongoose";
import envKeys from "../../src/config/envKeys";

const openrouterGetFiles = async () => {
    try {
        console.time('total-time');
        await mongoose.connect(envKeys.MONGODB_URI);

        const userApiKey = await ModelUserApiKey.findOne({
            username: 'exampleuser',
        });

        if (!userApiKey) {
            throw new Error('User API key not found');
        }

        const response = await axios.get('https://openrouter.ai/api/v1/models', {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userApiKey.apiKeyOpenrouter}`,
            },
        });
        console.log(response.data);

        let resModelsList = response.data.data;

        let modelsList = [] as {
            id: string;
            name: string;
            description: string;
            input_modalities: string[];
            isText: boolean;
            isImage: boolean;
            isAudio: boolean;
            isVideo: boolean;
            isFile: boolean;
            isOther: boolean;
        }[];

        for (let index = 0; index < resModelsList.length; index++) {
            const element = resModelsList[index];
            let modelData = {
                id: element.id,
                name: element.name,
                description: element.description,
                input_modalities: element.architecture.input_modalities,
                isText: element.architecture.input_modalities.includes('text'),
                isImage: element.architecture.input_modalities.includes('image'),
                isAudio: element.architecture.input_modalities.includes('audio'),
                isVideo: element.architecture.input_modalities.includes('video'),
                isFile: element.architecture.input_modalities.includes('file'),
                isOther: element.architecture.input_modalities.includes('other'),
            };

            modelsList.push(modelData);
        }

        for (let index = 0; index < modelsList.length; index++) {
            const element = modelsList[index];
            if(element.isVideo) {
                console.log(element.id);
                console.log(element.name);
                console.log(element.description);
                console.log(element.input_modalities);
                console.log(element.isText);
                console.log(element.isImage);
            }
        }

        console.timeEnd('total-time');
        mongoose.disconnect();
    } catch (error) {
        console.error(error);
    }
}

openrouterGetFiles();

// npx ts-node srcTest/2025-09-14-openrouter-get-files/2025-09-14-openrouter-get-files.ts
// npx ts-node -r dotenv/config ./srcTest/2025-09-14-openrouter-get-files/2025-09-14-openrouter-get-files.ts