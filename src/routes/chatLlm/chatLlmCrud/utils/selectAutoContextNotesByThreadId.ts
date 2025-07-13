import mongoose from "mongoose";
import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";
import { ModelNotes } from "../../../../schema/schemaNotes/SchemaNotes.schema";
import { ModelChatLlm } from "../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { IChatLlm } from "../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { INotes } from "../../../../types/typesSchema/typesSchemaNotes/SchemaNotes.types";
import { ModelChatLlmThreadContextReference } from "../../../../schema/schemaChatLlm/SchemaChatLlmThreadContextReference.schema";
import openrouterMarketing from "../../../../config/openrouterMarketing";

interface Message {
    role: string;
    content: string;
}

interface RequestData {
    messages: Message[];
    model: string;
    temperature: number;
    max_tokens: number;
    top_p: number;
    stream: boolean;
    response_format: {
        type: "json_object"
    };
    stop: null | string;
}

interface RelevantNotesResponse {
    relevantNotes: {
        noteId: string;
        relevanceScore: number;
        relevanceReason: string;
    }[];
}

const getLast20ConversationsByThreadId = async ({
    threadId,
    username,
}: {
    threadId: mongoose.Types.ObjectId,
    username: string,
}) => {
    try {
        const resultChat = await ModelChatLlm.aggregate([
            {
                $match: {
                    username,
                    threadId,
                }
            },
            {
                $sort: {
                    updatedAtUtc: -1,
                }
            },
            {
                $limit: 20,
            }
        ]) as IChatLlm[];

        return resultChat;
    } catch (error) {
        console.error(error);
        return [];
    }
}

const fetchLlmForNotesAnalysis = async ({
    argMessages,
    llmAuthToken,
    provider,
}: {
    argMessages: Message[];
    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}): Promise<string> => {
    try {
        let apiEndpoint = '';
        let modelName = '';
        if (provider === 'openrouter') {
            apiEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
            modelName = 'meta-llama/llama-3.2-11b-vision-instruct';
        } else if (provider === 'groq') {
            apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
            modelName = 'llama-3.1-8b-instant';
        }

        const data: RequestData = {
            messages: argMessages,
            model: modelName,
            temperature: 0.1,
            max_tokens: 4096,
            top_p: 1,
            stream: false,
            response_format: {
                type: "json_object"
            },
            stop: null,
        };

        const config: AxiosRequestConfig = {
            method: 'post',
            url: apiEndpoint,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${llmAuthToken}`,
                ...openrouterMarketing,
            },
            data: JSON.stringify(data)
        };

        const response: AxiosResponse = await axios.request(config);
        return response.data.choices[0].message.content;
    } catch (error) {
        if (isAxiosError(error)) {
            console.error(error.message);
        }
        console.log(error);
        return '';
    }
};

const getTop5RelevantNotes = ({
    validatedResponse,
    suggestedNotes,
}: {
    validatedResponse: RelevantNotesResponse;
    suggestedNotes: INotes[];
}) => {
    try {
        // Combine note details with relevance info
        const result = validatedResponse.relevantNotes
            .map(suggestion => {
                const note = suggestedNotes.find(n => 
                    (n._id as mongoose.Types.ObjectId).toString() === suggestion.noteId
                );
                if (note) {
                    return {
                        note,
                        relevanceScore: suggestion.relevanceScore,
                        relevanceReason: suggestion.relevanceReason,
                    };
                }
                return null;
            })
            .filter(item => item !== null)
            .sort((a, b) => b!.relevanceScore - a!.relevanceScore);

        // Return top 5 results
        return result.slice(0, 5);
    } catch (error) {
        console.error('Error in getTop5RelevantNotes:', error);
        return [];
    }
};

const insertTop5ContextReferences = async ({
    top5Results,
    username,
}: {
    top5Results: Array<{
        note: INotes;
        relevanceScore: number;
        relevanceReason: string;
    }>;
    username: string;
}) => {
    try {
        if (top5Results.length > 0) {
            for (const item of top5Results) {
                const existingReference = await ModelChatLlmThreadContextReference.findOne({
                    referenceFrom: 'notes',
                    referenceId: item.note._id,
                    username,
                });

                if (!existingReference) {
                    await ModelChatLlmThreadContextReference.create({
                        referenceFrom: 'notes',
                        referenceId: item.note._id,
                        username,
                    });
                }
            }
        }
        return true;
    } catch (error) {
        console.error('Error in insertTop5ContextReferences:', error);
        return false;
    }
};

const analyzeConversationWithLlm = async ({
    conversations,
    notes,
    llmAuthToken,
    provider,
}: {
    conversations: IChatLlm[];
    notes: INotes[];
    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}): Promise<RelevantNotesResponse | null> => {
    try {
        const systemPrompt = `You are an AI assistant that analyzes conversation context and suggests relevant notes. 

        Your task:
        1. Analyze the conversation context to understand the topics, themes, and user's interests
        2. Review the available notes and identify which ones are most relevant to the conversation
        3. Score each relevant note from 1-10 based on relevance
        4. Provide a brief reason for each suggestion
        5. Return only the top 5 most relevant notes (minimum score of 6)

        Return your response in this JSON format:
        {
        "relevantNotes": [
            {
            "noteId": "note_id_here",
            "relevanceScore": 8,
            "relevanceReason": "Brief explanation why this note is relevant"
            }
        ]
        }

        Only return notes with relevance score >= 6. If no notes are relevant enough, return an empty array.`;

        const conversationContext = conversations
            .map(conversation => conversation.content)
            .join('\n');

        const notesSummary = notes.map(note => ({
            id: (note._id as mongoose.Types.ObjectId).toString(),
            title: note.title,
            tags: note.tags,
            aiTags: note.aiTags,
        }));

        let notesStr = '';
        for (const note of notesSummary) {
            notesStr += `ID: ${note.id}\nTitle: ${note.title}\nTags: ${note.tags.join(', ')}\nAI Tags: ${note.aiTags.join(', ')}\n\n`;
        }

        const messages: Message[] = [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: `CONVERSATION CONTEXT:\n${conversationContext}\n\nAVAILABLE NOTES:\n${notesStr}`
            }
        ];

        const llmResponse = await fetchLlmForNotesAnalysis({
            argMessages: messages,
            llmAuthToken,
            provider,
        });

        console.log('llmResponse: ', llmResponse);

        // Parse LLM response with validation
        let parsedResponse: RelevantNotesResponse;
        try {
            parsedResponse = JSON.parse(llmResponse) as RelevantNotesResponse;
        } catch (parseError) {
            console.error('Failed to parse LLM response:', parseError);
            return null;
        }

        // Validate the parsed response structure
        if (!parsedResponse || typeof parsedResponse !== 'object') {
            console.error('Invalid response format: not an object');
            return null;
        }

        if (!parsedResponse.relevantNotes || !Array.isArray(parsedResponse.relevantNotes)) {
            console.error('Invalid response format: relevantNotes not found or not an array');
            return null;
        }

        // Validate each note in the response
        const validNotes = [];
        for (let index = 0; index < parsedResponse.relevantNotes.length; index++) {
            const noteItem = parsedResponse.relevantNotes[index];

            if (typeof noteItem === 'object' && noteItem !== null) {
                if (typeof noteItem.noteId === 'string' &&
                    typeof noteItem.relevanceScore === 'number' &&
                    typeof noteItem.relevanceReason === 'string') {
                    validNotes.push(noteItem);
                }
            }
        }

        if (validNotes.length === 0) {
            console.error('No valid notes found in LLM response');
            return null;
        }

        return { relevantNotes: validNotes };
    } catch (error) {
        console.error('Error in analyzeConversationWithLlm:', error);
        return null;
    }
};

const selectAutoContextNotesByThreadId = async ({
    threadId,
    username,
    llmAuthToken,
    provider,
}: {
    threadId: mongoose.Types.ObjectId,
    username: string,
    llmAuthToken: string;
    provider: 'groq' | 'openrouter';
}) => {
    try {
        const last20Conversations = await getLast20ConversationsByThreadId({
            threadId,
            username,
        });

        if (last20Conversations.length === 0) {
            return false;
        }

        const last20ConversationsDesc = last20Conversations.reverse();

        // Get all notes by username
        const resultNotes = await ModelNotes.aggregate([
            {
                $match: {
                    username,
                }
            }
        ]) as INotes[];
        if (resultNotes.length === 0) {
            return false;
        }

        // Use the new function for LLM analysis
        const validatedResponse = await analyzeConversationWithLlm({
            conversations: last20ConversationsDesc,
            notes: resultNotes,
            llmAuthToken,
            provider,
        });

        if (!validatedResponse) {
            return false;
        }

        // Get full note details for the suggested notes
        const suggestedNoteIds = validatedResponse.relevantNotes.map(item =>
            new mongoose.Types.ObjectId(item.noteId)
        );

        const suggestedNotes = await ModelNotes.find({
            _id: { $in: suggestedNoteIds },
            username,
        });

        // Get top 5 relevant notes using separate function
        const top5Results = getTop5RelevantNotes({
            validatedResponse,
            suggestedNotes,
        });

        // Insert top 5 relevant notes into context reference table
        const insertSuccess = await insertTop5ContextReferences({
            top5Results,
            username,
        });

        if (!insertSuccess) {
            console.error('Failed to insert context references');
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error in suggestAutoContextByThreadId:', error);
        return false;
    }
}

export default selectAutoContextNotesByThreadId;