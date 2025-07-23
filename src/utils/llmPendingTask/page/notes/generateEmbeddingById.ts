import { ObjectId } from 'mongodb';
import { NodeHtmlMarkdown } from 'node-html-markdown';

import { ModelUserApiKey } from "../../../../schema/SchemaUserApiKey.schema";
import { ModelNotes } from "../../../../schema/schemaNotes/SchemaNotes.schema";
import { INotes } from "../../../../types/typesSchema/typesSchemaNotes/SchemaNotes.types";

import { getQdrantClient } from '../../../../config/qdrantConfig';
import { generateEmbedding, generateUuidNamespaceDefaultDomain } from '../../../llm/ollamaCommonFunc';
import { v5 as uuidv5 } from 'uuid';

const generateEmbeddingById = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        const notesRecords = await ModelNotes.find({
            _id: targetRecordId,
        }) as INotes[];

        if (!notesRecords || notesRecords.length !== 1) {
            // TODO delete notes from vector db
            console.log('notesRecords not found');
            return true;
        }

        const notesFirst = notesRecords[0];
        const notesFirstId = notesFirst._id as ObjectId;

        const apiKeys = await ModelUserApiKey.findOne({
            username: notesFirst.username,
            apiKeyOllamaValid: true,
            apiKeyQdrantValid: true,
        });
        if (!apiKeys) {
            return true;
        }

        let argContent = `Title: ${notesFirst.title}\n`;
        if (notesFirst.description.length >= 1) {
            const markdownContent = NodeHtmlMarkdown.translate(notesFirst.description);
            argContent += `Description: ${markdownContent}\n`;
        }
        if (notesFirst.isStar) {
            argContent += `Is Star: Starred\n`;
        }
        if (notesFirst.tags.length >= 1) {
            argContent += `Tags: ${notesFirst.tags.join(', ')}\n`;
        }

        const resultGenerateEmbedding = await generateEmbedding({
            apiKeyOllamaEndpoint: apiKeys.apiKeyOllamaEndpoint,
            text: argContent,
        });

        console.log('resultGenerateEmbedding: ', resultGenerateEmbedding);

        if (resultGenerateEmbedding.error !== '') {
            return false;
        }

        const embedding = resultGenerateEmbedding.data.embedding;

        const uuid = uuidv5(`notes-record-${notesFirstId.toString()}`, generateUuidNamespaceDefaultDomain());
        console.log('uuid: ', uuid);

        // Prepare points for insertion
        const points = [
            {
                id: uuid,
                vector: embedding,
                payload: {
                    text: argContent,
                    collectionName: 'notes',
                    recordId: notesFirstId.toString(),
                    recordType: 'notes-record',
                }
            }
        ];

        const qdrantClient = await getQdrantClient({
            apiKeyQdrantEndpoint: apiKeys.apiKeyQdrantEndpoint,
            apiKeyQdrantPassword: apiKeys.apiKeyQdrantPassword,
        });

        if (!qdrantClient) {
            return false;
        }

        const collectionName = `index-user-${notesFirst.username}`;

        // create collection if not exists
        const resultGetCollection = await qdrantClient.getCollection(collectionName);
        if (resultGetCollection.status !== 'green') {
            const resultCreateCollection = await qdrantClient.createCollection(collectionName, {
                vectors: {
                    size: embedding.length,
                    distance: 'Cosine',
                },
            });
            console.log('resultCreateCollection: ', resultCreateCollection);
        }

        const result = await qdrantClient.upsert(collectionName, {
            wait: true,
            points: points,
        });

        console.log('result: ', result);

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export default generateEmbeddingById;