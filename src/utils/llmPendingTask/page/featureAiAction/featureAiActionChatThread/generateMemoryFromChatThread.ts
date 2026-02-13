import mongoose from 'mongoose';
import { ModelChatLlm } from "../../../../../schema/schemaChatLlm/SchemaChatLlm.schema";
import { ModelChatLlmThread } from "../../../../../schema/schemaChatLlm/SchemaChatLlmThread.schema";
import { ModelUser } from "../../../../../schema/schemaUser/SchemaUser.schema";
import { ModelUserMemory } from "../../../../../schema/schemaUser/SchemaUserMemory.schema";
import { IChatLlm } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlm.types";
import { IChatLlmThread } from "../../../../../types/typesSchema/typesChatLlm/SchemaChatLlmThread.types";
import { getDefaultLlmModel } from '../../../utils/getDefaultLlmModel';
import fetchLlmUnified from '../../../utils/fetchLlmUnified';
import { Message } from '../../../utils/fetchLlmUnified';
import { normalizeDateTimeIpAddress } from '../../../../../utils/llm/normalizeDateTimeIpAddress';

type MemoryItem = {
    _id: mongoose.Types.ObjectId;
    content: string;
    updatedAtUtc: Date | null;
    createdAtUtc: Date | null;
};

/**
 * Uses LLM to intelligently select which memories to keep when limit is exceeded
 */
const selectMemoriesToKeepUsingLLM = async ({
    memories,
    maxLimit,
    username,
}: {
    memories: MemoryItem[];
    maxLimit: number;
    username: string;
}): Promise<mongoose.Types.ObjectId[]> => {
    if (memories.length <= maxLimit) {
        return memories.map(m => m._id);
    }

    const llmConfig = await getDefaultLlmModel(username);
    if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) {
        throw new Error('LLM not available for memory selection');
    }

    const memoriesList = memories.map((m, i) => {
        const date = m.updatedAtUtc || m.createdAtUtc;
        return `${i + 1}. ${m.content}${date ? ` (Updated: ${date.toISOString()})` : ''}`;
    }).join('\n');

    const messages: Message[] = [
        {
            role: "system",
            content: `Select the ${maxLimit} most important memories from ${memories.length} options. Consider importance, uniqueness, recency, and utility. Output ONLY a JSON object. The object can have one or multiple keys. Values can be arrays, strings, or numbers representing memory indices (1-based). Examples: {"selectedMemories": [1, 3, 5]}, {"keep": "1,3,5"}, {"important": [1, 3], "recent": [5, 7]}`,
        },
        {
            role: "user",
            content: `Memories:\n${memoriesList}\n\nSelect exactly ${maxLimit} memories. Output JSON object with memory indices (1-based):`,
        }
    ];

    const llmResult = await fetchLlmUnified({
        provider: llmConfig.provider as 'openrouter' | 'groq' | 'ollama' | 'openai-compatible',
        apiKey: llmConfig.apiKey,
        apiEndpoint: llmConfig.apiEndpoint,
        model: llmConfig.modelName,
        messages,
        temperature: 0.3,
        maxTokens: 2048,
        topP: 1,
        responseFormat: 'json_object',
    });

    if (!llmResult.success || !llmResult.content) {
        throw new Error('LLM failed to generate memory selection response');
    }

    const response = JSON.parse(llmResult.content.trim());
    const selectedIndicesSet = new Set<number>();

    // Extract numbers from all values in the object
    const extractIndices = (value: any): number[] => {
        if (Array.isArray(value)) {
            return value.flatMap(extractIndices);
        } else if (typeof value === 'string') {
            // Parse comma-separated strings
            return value
                .split(',')
                .map(s => parseInt(s.trim(), 10))
                .filter(num => !isNaN(num));
        } else if (typeof value === 'number') {
            return [value];
        }
        return [];
    };

    // Process all values in the response object
    for (const key in response) {
        const indices = extractIndices(response[key]);
        indices.forEach(idx => {
            if (idx >= 1 && idx <= memories.length) {
                selectedIndicesSet.add(idx - 1); // Convert to 0-based
            }
        });
    }

    const selectedIndices = Array.from(selectedIndicesSet);

    if (selectedIndices.length < maxLimit) {
        throw new Error(`LLM returned insufficient memory selections: ${selectedIndices.length} < ${maxLimit}`);
    }

    return selectedIndices.slice(0, maxLimit).map((index: number) => memories[index]._id);
};

const generateMemoryFromChatThread = async ({
    targetRecordId,
}: {
    targetRecordId: string | null;
}) => {
    try {
        console.log('generateMemoryFromChatThread targetRecordId', targetRecordId);
        if (!targetRecordId) return true;

        const targetRecordIdObj = mongoose.Types.ObjectId.createFromHexString(targetRecordId.toString());
        if (!targetRecordIdObj) return true;

        // Get the thread to find username
        const [thread] = await ModelChatLlmThread.find({ _id: targetRecordIdObj }) as IChatLlmThread[];
        if (!thread) return true;

        const llmConfig = await getDefaultLlmModel(thread.username);
        if (!llmConfig.featureAiActionsEnabled || !llmConfig.provider) return true;

        const user = await ModelUser.findOne({ username: thread.username });
        if (!user?.featureAiActionsChatMessage) return true;

        // Check if user has memory storage enabled
        if (!user.isStoreUserMemoriesEnabled) {
            console.log('User has memory storage disabled, skipping memory generation');
            return true;
        }

        // Get last 6 conversations from the thread
        const lastConversations = await ModelChatLlm.find({
            username: thread.username,
            threadId: targetRecordIdObj,
            type: 'text',
        })
            .sort({ createdAtUtc: -1 })
            .limit(6)
            .lean() as IChatLlm[];

        // Sort ascending for chronological order
        lastConversations.sort((a, b) => {
            const aDate = a.createdAtUtc?.getTime() || 0;
            const bDate = b.createdAtUtc?.getTime() || 0;
            return aDate - bDate;
        });

        if (lastConversations.length === 0) return true;

        // Prepare content from all conversations
        let content = '';
        for (const conv of lastConversations) {
            if (conv.content?.trim()) {
                content += `${conv.content}\n`;
            }
            if (conv.fileContentText?.length) {
                content += `File Content: ${conv.fileContentText}\n`;
            }
        }

        if (content.trim().length < 20) return true;

        // Extract conversation-improving memories using LLM with strict validation
        const messages: Message[] = [
            {
                role: "system",
                content: `You are a memory extraction expert specializing in creating memories that improve future LLM conversations. Extract ONLY information that would genuinely help an AI assistant converse better with this user in future interactions.

MEMORY TYPES TO EXTRACT (in order of priority):
1. USER PREFERENCES: How they like to communicate, work, learn, or be treated
2. COMMUNICATION STYLE: Formal/informal, direct/indirect, detailed/concise preferences
3. IMPORTANT CONTEXT: Goals, deadlines, relationships, roles that affect conversations
4. PERSONAL DETAILS: Name preferences, professional background, expertise areas
5. CONVERSATION PATTERNS: How they typically ask questions, give feedback, make decisions

CRITICAL RULES:
1. ONLY extract information explicitly stated or strongly implied in the conversation
2. Memories must be RELEVANT and CONCISE for LLM context
3. Each memory must improve future conversation quality or personalization
4. Focus on actionable insights that change how an AI should respond
5. Skip generic or obvious information (e.g., "user likes coffee" unless it's conversationally relevant)
6. Prioritize memories that affect communication style, preferences, or context

OUTPUT FORMAT:
- One memory per line as bullet points
- Each memory: conversational improvement focused, naturally concise
- Format: "Memory: [concise memory text]"
- If fewer than 2 high-quality memories can be extracted, output "INSUFFICIENT_INFO"
- If no conversation-improving memories exist, output "NO_MEMORY"

EXAMPLES OF GOOD MEMORIES:
- "Prefers detailed technical explanations over simple answers"
- "Likes to discuss work-life balance in professional contexts"
- "Responds well to humor when discussing creative projects"
- "Prefers email communication for formal business matters"

EXAMPLES OF BAD MEMORIES (too generic/vague):
- "User works as a developer"
- "Likes technology discussions"
- "Has meetings on Fridays"`,
            },
            { role: "user", content },
        ];

        const llmResult = await fetchLlmUnified({
            provider: llmConfig.provider as 'openrouter' | 'groq' | 'ollama' | 'openai-compatible',
            apiKey: llmConfig.apiKey,
            apiEndpoint: llmConfig.apiEndpoint,
            model: llmConfig.modelName,
            messages,
            temperature: 0.1, // Lower temperature for more deterministic, factual responses
            maxTokens: 2048,
            topP: 1,
            responseFormat: 'text',
        });

        if (!llmResult.success || !llmResult.content?.trim()) return true;

        const extractedContent = llmResult.content.trim();
        if (extractedContent === 'NO_MEMORY' || extractedContent.toLowerCase().includes('no memory')) {
            return true;
        }

        if (extractedContent === 'INSUFFICIENT_INFO' || extractedContent.toLowerCase().includes('insufficient')) {
            return true;
        }

        // Parse conversation-improving memories
        const rawMemories = extractedContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('Memory:'))
            .map(line => line.replace(/^Memory:\s*/, '').trim())
            .filter(line => line.length >= 8); // minimum length for meaningful memories

        // Validate memories against original content to ensure grounding
        const validatedMemories: string[] = [];
        for (const memory of rawMemories) {
            // Check if the memory contains meaningful words from the original content
            const memoryWords = memory.toLowerCase().split(/\s+/);
            const contentWords = content.toLowerCase().split(/\s+/);

            // Count how many meaningful words from the memory appear in the content
            let matchingWords = 0;
            let meaningfulWords = 0;

            for (const word of memoryWords) {
                if (word.length > 3) { // Only count meaningful words
                    meaningfulWords++;
                    if (contentWords.includes(word)) {
                        matchingWords++;
                    }
                }
            }

            // Memory must have at least 20% of its meaningful words present in original content
            // OR be clearly derived from conversation patterns/preferences
            const matchRatio = meaningfulWords > 0 ? matchingWords / meaningfulWords : 0;

            // Allow slightly more interpretive memories since these are for conversation improvement
            if (matchRatio >= 0.2 || memory.includes('prefers') || memory.includes('likes') ||
                memory.includes('style') || memory.includes('communication')) {
                validatedMemories.push(memory);
            }
        }

        // Require minimum quality - at least 1 validated conversation-improving memory
        if (validatedMemories.length < 1) {
            console.log(`Insufficient validated memories (${validatedMemories.length}/${rawMemories.length}), skipping memory creation`);
            return true;
        }

        const memories = validatedMemories;

        if (memories.length === 0) return true;

        const userMemoriesLimit = user.userMemoriesLimit || 15;
        
        // Use the most recent conversation's datetime for action
        const mostRecentConv = lastConversations[lastConversations.length - 1];
        const actionDatetimeObj = normalizeDateTimeIpAddress({
            createdAtUtc: mostRecentConv.createdAtUtc,
            createdAtIpAddress: mostRecentConv.createdAtIpAddress || '',
            createdAtUserAgent: mostRecentConv.createdAtUserAgent || '',
            updatedAtUtc: mostRecentConv.updatedAtUtc,
            updatedAtIpAddress: mostRecentConv.updatedAtIpAddress || '',
            updatedAtUserAgent: mostRecentConv.updatedAtUserAgent || '',
        });

        // Get existing memories for duplicate check
        const existingMemories = await ModelUserMemory.find({
            username: thread.username,
        }).select('content _id').lean();

        const memoryMap = new Map<string, mongoose.Types.ObjectId>();
        const processedInBatch = new Set<string>();

        for (const mem of existingMemories) {
            const key = mem.content.trim().toLowerCase();
            if (!memoryMap.has(key)) {
                memoryMap.set(key, mem._id as mongoose.Types.ObjectId);
            }
        }

        // Create or update memories
        for (const memory of memories) {
            const normalizedMemory = memory.trim();
            const key = normalizedMemory.toLowerCase();

            if (processedInBatch.has(key)) continue;

            const existingId = memoryMap.get(key);
            if (existingId) {
                await ModelUserMemory.updateOne(
                    { _id: existingId },
                    { $set: { ...actionDatetimeObj } }
                );
            } else {
                await ModelUserMemory.create({
                    username: thread.username,
                    content: normalizedMemory,
                    isPermanent: false,
                    ...actionDatetimeObj,
                });
                processedInBatch.add(key);
            }
        }

        // Enforce memory limit using LLM selection
        const allNonPermanentMemories = await ModelUserMemory.find({
            username: thread.username,
            isPermanent: false,
        })
            .select('_id content updatedAtUtc createdAtUtc')
            .lean();

        if (allNonPermanentMemories.length > userMemoriesLimit) {
            try {
                const memoriesToKeep = await selectMemoriesToKeepUsingLLM({
                    memories: allNonPermanentMemories.map(m => ({
                        _id: m._id as mongoose.Types.ObjectId,
                        content: m.content,
                        updatedAtUtc: m.updatedAtUtc,
                        createdAtUtc: m.createdAtUtc,
                    })),
                    maxLimit: userMemoriesLimit,
                    username: thread.username,
                });

                const idsToKeepSet = new Set(memoriesToKeep.map(id => id.toString()));
                const idsToDelete = allNonPermanentMemories
                    .filter(m => !idsToKeepSet.has(m._id.toString()))
                    .map(m => m._id);

                if (idsToDelete.length > 0) {
                    await ModelUserMemory.deleteMany({ _id: { $in: idsToDelete } });
                }
            } catch (error) {
                console.error('Error selecting memories using LLM, skipping memory limit enforcement:', error);
                // If LLM fails, don't enforce limit - keep all memories
            }
        }

        return true;
    } catch (error) {
        console.error('Error generating memory from chat thread:', error);
        return false;
    }
};

export default generateMemoryFromChatThread;
